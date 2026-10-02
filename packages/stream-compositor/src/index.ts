import type {
  CdpEventParams,
  CdpTransport,
  Detach,
  Viewport,
} from '@openuji/cdp';
import {
  createPushStream,
  type CompositorFrame,
  type PushStreamStats,
} from '@openuji/core';

type RawFrame = CdpEventParams<'Page.screencastFrame'>;

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

  const unsubscribe = cdp.on('Page.screencastFrame', (raw, { receivedAtMs }) => {
    // ACK first, before any other work: Chromium withholds the next frame until
    // the previous one is acknowledged, so any delay here throttles the stream.
    void cdp
      .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
      .catch(() => {});

    emit(toFrame(raw, ++frameCount, receivedAtMs));
  });

  try {
    const bounds = await screencastBounds(cdp, options);
    await cdp.send('Page.startScreencast', {
      format: options.format ?? 'png',
      quality: options.quality,
      everyNthFrame: options.everyNthFrame ?? 1,
      maxWidth: bounds.width,
      maxHeight: bounds.height,
    });
  } catch (err) {
    unsubscribe();
    throw err;
  }

  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    unsubscribe();
  };
}

/** A CDP screencast frame as a domain frame. Pure. */
function toFrame(
  { data, metadata }: RawFrame,
  index: number,
  receivedAtMs: number,
): CompositorFrame {
  return {
    index,
    base64: data,
    scrollX: metadata.scrollOffsetX,
    scrollY: metadata.scrollOffsetY,
    viewportWidth: metadata.deviceWidth,
    viewportHeight: metadata.deviceHeight,
    pageScaleFactor: metadata.pageScaleFactor,
    receivedAtMs,
    // CDP's frame-swap time (when the frame was on screen) is optional and in
    // epoch seconds.
    swapTimeMs:
      metadata.timestamp === undefined ? undefined : metadata.timestamp * 1000,
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
