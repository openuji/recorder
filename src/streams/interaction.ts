import { chromium, type CDPSession, type Page } from 'playwright';
import type { TargetElementMeta } from '../types.js';

export type InteractionAction = 'click' | 'input' | 'change' | 'scrollend';

export type InteractionEvent = Readonly<{
  action: InteractionAction;
  target: TargetElementMeta;
  timestamp: number;
}>;

export interface InteractionStreamHandle {
  events: AsyncIterable<InteractionEvent>;
  stop: () => Promise<void>;
}

export const IN_PAGE_INTERACTION_SCRIPT = `
(() => {
  if (window.__uxr_injected__) return;
  window.__uxr_injected__ = true;

  function getSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'unknown';
    let path = el.tagName.toLowerCase();
    if (el.id) {
      return path + '#' + el.id;
    }
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
      if (classes) path += '.' + classes;
    }
    return path;
  }

  function extractMeta(e) {
    const target = e.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;

    const rect = target.getBoundingClientRect();
    const textSnippet = (target.innerText || target.value || target.getAttribute('aria-label') || '')
      .trim()
      .replace(/\\s+/g, ' ')
      .slice(0, 40);

    return {
      tagName: target.tagName.toLowerCase(),
      id: target.id || undefined,
      className: target.className && typeof target.className === 'string' ? target.className : undefined,
      selector: getSelector(target),
      role: target.getAttribute('role') || target.tagName.toLowerCase(),
      ariaLabel: target.getAttribute('aria-label') || undefined,
      textSnippet: textSnippet || undefined,
      href: target.getAttribute('href') || undefined,
      inputType: target.getAttribute('type') || undefined,
      name: target.getAttribute('name') || undefined,
      clientX: e.clientX,
      clientY: e.clientY,
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  window.addEventListener('click', (e) => {
    const meta = extractMeta(e);
    if (!meta) return;
    if (typeof window.__uxr_interaction__ === 'function') {
      window.__uxr_interaction__(JSON.stringify({
        action: 'click',
        target: meta,
        timestamp: Date.now() / 1000,
      }));
    }
  }, true);

  window.addEventListener('scrollend', (e) => {
    const meta = extractMeta(e) || {
      tagName: 'window',
      selector: 'window',
      clientX: 0,
      clientY: 0,
      boundingRect: {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
    if (typeof window.__uxr_interaction__ === 'function') {
      window.__uxr_interaction__(JSON.stringify({
        action: 'scrollend',
        target: meta,
        timestamp: Date.now() / 1000,
      }));
    }
  }, true);
})();
`;

/**
 * Attaches the in-page DOM interaction probe via CDP Runtime.addBinding
 * and emits an AsyncIterable stream of user interactions.
 */
export async function createInteractionStream(
  page: Page,
  existingClient?: CDPSession,
): Promise<InteractionStreamHandle> {
  const client: CDPSession =
    existingClient ?? (await page.context().newCDPSession(page));

  type QueueItem =
    | { type: 'event'; event: InteractionEvent }
    | { type: 'end' }
    | { type: 'error'; error: unknown };

  const queue: QueueItem[] = [];
  let pendingResolver: (() => void) | null = null;
  let isClosed = false;

  const notify = () => {
    if (pendingResolver) {
      const resolve = pendingResolver;
      pendingResolver = null;
      resolve();
    }
  };

  await client.send('Runtime.enable');
  await client.send('Runtime.addBinding', { name: '__uxr_interaction__' });

  client.on('Runtime.bindingCalled', (raw: any) => {
    if (isClosed) return;
    if (raw.name === '__uxr_interaction__') {
      try {
        const payload = JSON.parse(raw.payload);
        queue.push({
          type: 'event',
          event: {
            action: payload.action,
            target: payload.target,
            timestamp: payload.timestamp,
          },
        });
        notify();
      } catch (err) {
        console.error('Failed to parse interaction payload:', err);
      }
    }
  });

  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: IN_PAGE_INTERACTION_SCRIPT,
  });

  const events: AsyncIterable<InteractionEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<InteractionEvent>> {
          while (true) {
            if (queue.length > 0) {
              const item = queue.shift()!;
              if (item.type === 'event') {
                return { value: item.event, done: false };
              }
              if (item.type === 'end') {
                return { value: undefined as any, done: true };
              }
              if (item.type === 'error') {
                throw item.error;
              }
            }

            if (isClosed) {
              return { value: undefined as any, done: true };
            }

            await new Promise<void>((resolve) => {
              pendingResolver = resolve;
            });
          }
        },
      };
    },
  };

  const stop = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;

    if (!existingClient) {
      await client.detach().catch(() => {});
    }

    queue.push({ type: 'end' });
    notify();
  };

  return { events, stop };
}

/* ============================================================
 * STANDALONE RUNNER
 * ============================================================ */

async function main(): Promise<void> {
  const targetUrl = process.argv[2] ?? 'https://example.com';

  console.log('Launching browser (standalone interaction probe)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Attaching interaction probe...');
  const { events, stop } = await createInteractionStream(page);

  const consumerPromise = (async () => {
    for await (const event of events) {
      const target = event.target;
      console.log(
        `\x1b[35m[INTERACTION: ${event.action.toUpperCase()}]\x1b[0m ` +
          `<${target.selector}> "${target.textSnippet ?? ''}" ` +
          `role:${target.role ?? '-'} at:(${target.clientX}, ${target.clientY}) ` +
          `rect:[${target.boundingRect.width}x${target.boundingRect.height}]`,
      );
    }
  })();

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'commit' });
  console.log('Page ready. Click elements or scroll to see live DOM inspection. Press Ctrl+C to stop.\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping interaction stream...');
    await stop();
    await consumerPromise;
    await browser.close().catch(() => {});
    console.log('Done.');
    process.exit(0);
  };

  process.on('SIGINT', () => void teardown());
  process.on('SIGTERM', () => void teardown());
  browser.on('disconnected', () => void teardown());
}

if (process.argv[1]?.endsWith('interaction.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
