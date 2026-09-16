import { chromium, type CDPSession, type Page } from 'playwright';
import type { DomainEvent, MilestoneCapture } from '../types.js';
import { createCompositorStream } from './compositor.js';
import { createLifecycleStream } from './lifecycle.js';
import { createInteractionStream } from './interaction.js';
import { ModularRulesEngine } from '../engine/rules-engine.js';
import { defaultRules } from '../rules/index.js';

export interface FusedStreamHandle {
  events: AsyncIterable<DomainEvent>;
  stop: () => Promise<void>;
}

/**
 * Creates a fused domain event stream by multiplexing Compositor, Lifecycle,
 * and In-Page Interaction streams over a single shared CDP session.
 */
export async function createFusedStream(
  page: Page,
  client?: CDPSession,
): Promise<FusedStreamHandle> {
  const cdpClient = client ?? (await page.context().newCDPSession(page));

  type QueueItem =
    | { type: 'event'; event: DomainEvent }
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

  const [compositor, lifecycle, interaction] = await Promise.all([
    createCompositorStream(page, {}, cdpClient),
    createLifecycleStream(page, cdpClient),
    createInteractionStream(page, cdpClient),
  ]);

  // Consumer 1: Compositor frames
  const p1 = (async () => {
    for await (const frame of compositor.frames) {
      if (isClosed) break;
      queue.push({ type: 'event', event: { type: 'frame', frame } });
      notify();
    }
  })();

  // Consumer 2: Lifecycle events
  const p2 = (async () => {
    for await (const ev of lifecycle.events) {
      if (isClosed) break;
      if (ev.type === 'committed') {
        queue.push({
          type: 'event',
          event: {
            type: 'committed',
            frameId: ev.frameId,
            isMainFrame: ev.isMainFrame,
            loaderId: ev.loaderId,
            url: ev.url,
            timestamp: ev.timestamp,
          },
        });
      } else {
        queue.push({
          type: 'event',
          event: {
            type: 'lifecycle',
            frameId: ev.frameId,
            loaderId: ev.loaderId,
            name: ev.name,
            timestamp: ev.timestamp,
          },
        });
      }
      notify();
    }
  })();

  // Consumer 3: In-page DOM interactions
  const p3 = (async () => {
    for await (const ev of interaction.events) {
      if (isClosed) break;
      queue.push({
        type: 'event',
        event: {
          type: 'interaction',
          action: ev.action,
          target: ev.target,
          timestamp: ev.timestamp,
        },
      });
      notify();
    }
  })();

  const events: AsyncIterable<DomainEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<DomainEvent>> {
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

    await Promise.all([
      compositor.stop().catch(() => {}),
      lifecycle.stop().catch(() => {}),
      interaction.stop().catch(() => {}),
    ]);

    await Promise.all([p1, p2, p3]).catch(() => {});

    if (!client) {
      await cdpClient.detach().catch(() => {});
    }

    queue.push({ type: 'end' });
    notify();
  };

  return { events, stop };
}

/* ============================================================
 * STANDALONE RUNNER (Zero Disk I/O, Pure Live Detections)
 * ============================================================ */

async function main(): Promise<void> {
  const targetUrl = process.argv[2] ?? 'https://example.com';

  console.log('Launching browser (fused stream detection mode)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const engine = new ModularRulesEngine(defaultRules);

  const printCapture = (capture: MilestoneCapture) => {
    const shortLoader = capture.loaderId.slice(0, 8);
    const sizeKb = (capture.frame.buffer.byteLength / 1024).toFixed(1);

    const isInteraction =
      capture.label.includes('click') || capture.label.includes('scroll');
    const color = isInteraction
      ? '\x1b[35m'
      : capture.label.includes('99')
        ? '\x1b[33m'
        : '\x1b[36m';

    console.log(
      `${color}★ [NAV #${capture.documentId}] ${capture.label.padEnd(20, ' ')}\x1b[0m | ` +
        `loader: ${shortLoader} | ` +
        `frame #${capture.frame.index} (${sizeKb} KB) | ` +
        `${capture.detail}`,
    );

    if (capture.domTarget) {
      console.log(
        `    \x1b[90m↳ DOM: <${capture.domTarget.selector}> text:"${capture.domTarget.textSnippet ?? ''}" ` +
          `role:${capture.domTarget.role ?? '-'} at:(${capture.domTarget.clientX}, ${capture.domTarget.clientY}) ` +
          `rect:[${capture.domTarget.boundingRect.width}x${capture.domTarget.boundingRect.height}]\x1b[0m`,
      );
    }
  };

  console.log('Starting fused stream...');
  const { events, stop } = await createFusedStream(page);

  const consumerPromise = (async () => {
    for await (const event of events) {
      const captures = engine.processEvent(event);
      for (const capture of captures) {
        printCapture(capture);
      }
    }
  })();

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'commit' });
  console.log('\nReady! Live detections will print in real time without writing to disk.');
  console.log('Press Ctrl+C to stop.\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping fused stream...');
    // Emit stop event into engine to capture final state
    const stopCaptures = engine.processEvent({ type: 'stop' });
    for (const c of stopCaptures) {
      printCapture(c);
    }

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

if (process.argv[1]?.endsWith('fused.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
