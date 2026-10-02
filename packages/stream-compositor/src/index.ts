import type { CdpTransport, Detach, Viewport } from '@openuji/cdp';
import {
  createPushStream,
  type CompositorFrame,
  type PushStreamStats,
} from '@openuji/core';

/** Used only when neither the caller nor CDP can say how big the viewport is. */
const FALLBACK_VIEWPORT: Viewport = { width: 1280, height: 800 };

/** What `Page.startScreencast` is asked for. */
export interface ScreencastOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  everyNthFrame?: number;
  /**
   * CSS viewport of the recorded page, when the host knows it (a launched
   * browser does; an attached tab does not). Bounds the frame size unless
   * `maxWidth`/`maxHeight` override it. Omit to read it from
   * `Page.getLayoutMetrics`.
   */
  viewport?: Viewport;
  maxWidth?: number;
  maxHeight?: number;
}

export interface CompositorStreamOptions extends ScreencastOptions {
  /**
   * Cap on frames queued but not yet consumed. Frames carry full encoded
   * images, so an unbounded queue behind a slow consumer grows without limit.
   *
   * Omit for an unbounded queue (the default, and what the recorder uses): rules
   * count frames and fire on "the next frame after X", so dropping frames
   * changes which moment gets captured. Set this only where a bounded memory
   * ceiling matters more than frame-exact captures.
   */
  maxPendingFrames?: number;
  /** Called for each dropped frame once `maxPendingFrames` is exceeded. */
  onDrop?: (frame: CompositorFrame, totalDropped: number) => void;
}

export interface CompositorStreamHandle {
  frames: AsyncIterable<CompositorFrame>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Attaches the compositor source: emits a frame for every CDP
 * `Page.screencastFrame`, synchronously, from inside the event handler.
 *
 * This is the one implementation of the source. The standalone stream below
 * and the fused orchestrator both run it, so what you see in isolation is
 * exactly what the fused stream is fed.
 */
export async function attachCompositor(
  cdp: CdpTransport,
  emit: (frame: CompositorFrame) => void,
  options: ScreencastOptions = {},
): Promise<Detach> {
  let frameCount = 0;

  const unsubscribe = cdp.on('Page.screencastFrame', (raw) => {
    // ACK first, before any other work: Chromium withholds the next frame until
    // the previous one is acknowledged, so any delay here throttles the stream.
    void cdp
      .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
      .catch(() => {});

    const meta = raw.metadata;
    emit({
      index: ++frameCount,
      // Chromium reports a frame-swap timestamp in seconds; the domain model
      // uses epoch milliseconds.
      timestamp: meta?.timestamp ? meta.timestamp * 1000 : Date.now(),
      scrollX: meta?.scrollOffsetX ?? 0,
      scrollY: meta?.scrollOffsetY ?? 0,
      viewportWidth: meta?.deviceWidth ?? 0,
      viewportHeight: meta?.deviceHeight ?? 0,
      pageScaleFactor: meta?.pageScaleFactor ?? 1,
      base64: raw.data,
    });
  });

  try {
    const bounds = await screencastBounds(cdp, options);
    await cdp.send('Page.startScreencast', {
      format: options.format ?? 'png',
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      everyNthFrame: options.everyNthFrame ?? 1,
      maxWidth: bounds.width,
      maxHeight: bounds.height,
    });
  } catch (err) {
    unsubscribe();
    throw err;
  }

  let detached = false;
  return async () => {
    if (detached) return;
    detached = true;

    await cdp.send('Page.stopScreencast').catch(() => {});
    unsubscribe();
  };
}

/**
 * Streams visual frames from CDP `Page.screencastFrame`, on its own — no
 * orchestrator, no sibling streams. Leaves the transport to its owner.
 */
export async function createCompositorStream(
  cdp: CdpTransport,
  options: CompositorStreamOptions = {},
): Promise<CompositorStreamHandle> {
  const { maxPendingFrames, onDrop, ...screencast } = options;

  const stream = createPushStream<CompositorFrame>({
    ...(maxPendingFrames !== undefined ? { capacity: maxPendingFrames } : {}),
    ...(onDrop ? { onDrop } : {}),
  });

  const detach = await attachCompositor(
    cdp,
    (frame) => stream.push(frame),
    screencast,
  );

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    await detach();
    stream.end();
  };

  return { frames: stream.iterable, stop, stats: stream.stats };
}

async function screencastBounds(
  cdp: CdpTransport,
  options: ScreencastOptions,
): Promise<Viewport> {
  const { maxWidth, maxHeight } = options;
  if (maxWidth !== undefined && maxHeight !== undefined) {
    return { width: maxWidth, height: maxHeight };
  }

  const viewport =
    options.viewport ??
    (await cdp
      .send('Page.getLayoutMetrics')
      .then(({ cssLayoutViewport }) => ({
        width: cssLayoutViewport.clientWidth,
        height: cssLayoutViewport.clientHeight,
      }))
      .catch(() => FALLBACK_VIEWPORT));

  return {
    width: maxWidth ?? viewport.width,
    height: maxHeight ?? viewport.height,
  };
}
