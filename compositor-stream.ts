import { chromium, type CDPSession, type Page } from 'playwright';

/* ============================================================
 * IMMUTABLE COMPOSITOR FRAME MODEL
 * ============================================================ */

export type CompositorFrame = Readonly<{
  index: number;
  timestamp: number; // Unix epoch ms
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  pageScaleFactor: number;
  buffer: Buffer;
}>;

export interface CompositorStreamOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  everyNthFrame?: number;
}

/* ============================================================
 * ASYNC ITERABLE STREAM GENERATOR
 * ============================================================ */

/**
 * Creates an immutable AsyncIterable stream of compositor frames from CDP.
 * Acknowledges CDP frames immediately to avoid compositor throttling.
 */
export async function createCompositorStream(
  page: Page,
  options: CompositorStreamOptions = {},
): Promise<{
  frames: AsyncIterable<CompositorFrame>;
  stop: () => Promise<void>;
}> {
  const client: CDPSession = await page.context().newCDPSession(page);

  type QueueItem =
    | { type: 'frame'; frame: CompositorFrame }
    | { type: 'end' }
    | { type: 'error'; error: unknown };

  const queue: QueueItem[] = [];
  let pendingResolver: (() => void) | null = null;
  let isClosed = false;
  let frameCount = 0;

  const notify = () => {
    if (pendingResolver) {
      const resolve = pendingResolver;
      pendingResolver = null;
      resolve();
    }
  };

  const onScreencastFrame = (raw: any) => {
    if (isClosed) return;

    // 1. Immediately ACK back to Chromium to maintain fluid frame delivery
    void client
      .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
      .catch(() => {});

    // 2. Wrap into an immutable frame record
    const meta = raw.metadata ?? {};
    const frame: CompositorFrame = {
      index: ++frameCount,
      timestamp: meta.timestamp ? meta.timestamp * 1000 : Date.now(),
      scrollX: meta.scrollOffsetX ?? 0,
      scrollY: meta.scrollOffsetY ?? 0,
      viewportWidth: meta.deviceWidth ?? 0,
      viewportHeight: meta.deviceHeight ?? 0,
      pageScaleFactor: meta.pageScaleFactor ?? 1,
      buffer: Buffer.from(raw.data, 'base64'),
    };

    queue.push({ type: 'frame', frame });
    notify();
  };

  client.on('Page.screencastFrame', onScreencastFrame);

  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  await client.send('Page.startScreencast', {
    format: options.format ?? 'png',
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
    everyNthFrame: options.everyNthFrame ?? 1,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
  });

  const frames: AsyncIterable<CompositorFrame> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<CompositorFrame>> {
          while (true) {
            if (queue.length > 0) {
              const item = queue.shift()!;
              if (item.type === 'frame') {
                return { value: item.frame, done: false };
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

    await client.send('Page.stopScreencast').catch(() => {});
    await client.detach().catch(() => {});

    queue.push({ type: 'end' });
    notify();
  };

  return { frames, stop };
}

/* ============================================================
 * RUNNER / DEMO
 * ============================================================ */

async function main(): Promise<void> {
  const targetUrl = process.argv[2] ?? 'https://example.com';

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Starting compositor stream...');
  const { frames, stop } = await createCompositorStream(page);

  // Consume the stream asynchronously
  const consumerPromise = (async () => {
    const startTime = Date.now();
    for await (const frame of frames) {
      const elapsedMs = (frame.timestamp - startTime).toFixed(0);
      const sizeKb = (frame.buffer.byteLength / 1024).toFixed(1);

      console.log(
        `[Frame #${String(frame.index).padStart(4, '0')}] ` +
          `+${elapsedMs.padStart(5, ' ')}ms | ` +
          `size: ${sizeKb.padStart(6, ' ')} KB | ` +
          `scroll: (${frame.scrollX}, ${frame.scrollY}) | ` +
          `viewport: ${frame.viewportWidth}x${frame.viewportHeight} @${frame.pageScaleFactor}x`,
      );
    }
  })();

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  console.log('Page loaded. Scroll around or interact with the page.');
  console.log('Press Ctrl+C or close the browser window to stop.\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping compositor stream...');
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

if (process.argv[1]?.endsWith('compositor-stream.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
