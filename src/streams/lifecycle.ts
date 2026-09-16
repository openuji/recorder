import { chromium, type CDPSession, type Page } from 'playwright';
import type { LifecycleEvent } from '../types.js';

export interface LifecycleStreamHandle {
  events: AsyncIterable<LifecycleEvent>;
  stop: () => Promise<void>;
}

/**
 * Creates an AsyncIterable stream of navigation lifecycle events from CDP.
 * Tracks loaderId identity, main frame boundaries, and monotonic paint milestones.
 */
export async function createLifecycleStream(
  page: Page,
  existingClient?: CDPSession,
): Promise<LifecycleStreamHandle> {
  const client: CDPSession =
    existingClient ?? (await page.context().newCDPSession(page));

  type QueueItem =
    | { type: 'event'; event: LifecycleEvent }
    | { type: 'end' }
    | { type: 'error'; error: unknown };

  const queue: QueueItem[] = [];
  let pendingResolver: (() => void) | null = null;
  let isClosed = false;
  let mainFrameId: string | null = null;

  const notify = () => {
    if (pendingResolver) {
      const resolve = pendingResolver;
      pendingResolver = null;
      resolve();
    }
  };

  // 1. Listen for frame navigations (identifies new document commits & loaderIds)
  client.on('Page.frameNavigated', (raw: any) => {
    if (isClosed) return;
    const frame = raw.frame;
    const isMainFrame = !frame.parentId;

    if (isMainFrame) {
      mainFrameId = frame.id;
    }

    const event: LifecycleEvent = {
      type: 'committed',
      frameId: frame.id,
      isMainFrame,
      loaderId: frame.loaderId,
      url: frame.url,
      timestamp: Date.now() / 1000,
    };

    queue.push({ type: 'event', event });
    notify();
  });

  // 2. Listen for detailed lifecycle events (commit, DOMContentLoaded, load, firstContentfulPaint, etc.)
  client.on('Page.lifecycleEvent', (raw: any) => {
    if (isClosed) return;

    const isMainFrame = mainFrameId ? raw.frameId === mainFrameId : false;

    const event: LifecycleEvent = {
      type: 'milestone',
      frameId: raw.frameId,
      isMainFrame,
      loaderId: raw.loaderId,
      name: raw.name,
      timestamp: raw.timestamp,
    };

    queue.push({ type: 'event', event });
    notify();
  });

  await client.send('Page.enable');
  await client.send('Page.setLifecycleEventsEnabled', { enabled: true });

  // Bootstrap currently active root frame
  const tree: any = await client.send('Page.getFrameTree').catch(() => null);
  const root = tree?.frameTree?.frame;
  if (root?.id) {
    mainFrameId = root.id;
    if (root.loaderId && root.url && root.url !== 'about:blank') {
      queue.push({
        type: 'event',
        event: {
          type: 'committed',
          frameId: root.id,
          isMainFrame: true,
          loaderId: root.loaderId,
          url: root.url,
          timestamp: Date.now() / 1000,
        },
      });
      notify();
    }
  }

  const events: AsyncIterable<LifecycleEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<LifecycleEvent>> {
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

    await client
      .send('Page.setLifecycleEventsEnabled', { enabled: false })
      .catch(() => {});
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

  console.log('Launching browser (standalone lifecycle stream)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Starting lifecycle stream...');
  const { events, stop } = await createLifecycleStream(page);

  const consumerPromise = (async () => {
    let baselineTimestamp: number | null = null;

    for await (const event of events) {
      if (baselineTimestamp === null) {
        baselineTimestamp = event.timestamp;
      }

      const elapsedMs = ((event.timestamp - baselineTimestamp) * 1000).toFixed(0);
      const target = event.isMainFrame ? '[MainFrame]' : '[SubFrame ]';
      const shortLoaderId = event.loaderId.slice(0, 8);

      if (event.type === 'committed') {
        console.log(
          `\x1b[32m${target} COMMITTED\x1b[0m | ` +
            `loaderId: ${shortLoaderId} | ` +
            `+${elapsedMs.padStart(6, ' ')}ms | ` +
            `url: ${event.url}`,
        );
      } else {
        const isVisualMilestone =
          event.name === 'firstPaint' || event.name === 'firstContentfulPaint';
        const isDomMilestone =
          event.name === 'DOMContentLoaded' || event.name === 'load';

        const color = isVisualMilestone
          ? '\x1b[33m'
          : isDomMilestone
            ? '\x1b[36m'
            : '\x1b[90m';

        console.log(
          `${color}${target} MILESTONE: ${event.name.padEnd(20, ' ')}\x1b[0m | ` +
            `loaderId: ${shortLoaderId} | ` +
            `+${elapsedMs.padStart(6, ' ')}ms`,
        );
      }
    }
  })();

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'commit' });
  console.log('Page navigated. Interact with links/forms. Press Ctrl+C to stop.\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping lifecycle stream...');
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

if (process.argv[1]?.endsWith('lifecycle.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
