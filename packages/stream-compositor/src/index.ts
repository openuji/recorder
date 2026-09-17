import type { CDPSession, Page } from 'playwright';
import {
  createPushStream,
  ownSession,
  type CompositorFrame,
  type PushStreamStats,
} from '@openuji/core';

export interface CompositorStreamOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  everyNthFrame?: number;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * Cap on frames queued but not yet consumed. Frames carry full image buffers,
   * so an unbounded queue behind a slow consumer grows without limit.
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

/** Payload shape of the CDP `Page.screencastFrame` event. */
type ScreencastFrameEvent = {
  data: string;
  sessionId: number;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    /** Frame swap time, in seconds since the epoch. */
    timestamp?: number;
  };
};

export interface CompositorStreamHandle {
  frames: AsyncIterable<CompositorFrame>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Streams visual frames from CDP `Page.screencastFrame`.
 *
 * Pass `existingClient` to attach to a session someone else owns (the fused
 * orchestrator does this); the stream then leaves teardown of that session to
 * its owner.
 */
export async function createCompositorStream(
  page: Page,
  options: CompositorStreamOptions = {},
  existingClient?: CDPSession,
): Promise<CompositorStreamHandle> {
  const owned = ownSession(
    existingClient ?? (await page.context().newCDPSession(page)),
    !existingClient,
  );
  const client = owned.session;

  const stream = createPushStream<CompositorFrame>({
    ...(options.maxPendingFrames !== undefined
      ? { capacity: options.maxPendingFrames }
      : {}),
    ...(options.onDrop ? { onDrop: options.onDrop } : {}),
  });

  let frameCount = 0;

  const onScreencastFrame = (raw: ScreencastFrameEvent): void => {
    if (stream.closed) return;

    // ACK first, before any other work: Chromium withholds the next frame until
    // the previous one is acknowledged, so any delay here throttles the stream.
    void client
      .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
      .catch(() => {});

    const meta = raw.metadata;
    stream.push({
      index: ++frameCount,
      // Chromium reports a frame-swap timestamp in seconds; the domain model
      // uses epoch milliseconds.
      timestamp: meta?.timestamp ? meta.timestamp * 1000 : Date.now(),
      scrollX: meta?.scrollOffsetX ?? 0,
      scrollY: meta?.scrollOffsetY ?? 0,
      viewportWidth: meta?.deviceWidth ?? 0,
      viewportHeight: meta?.deviceHeight ?? 0,
      pageScaleFactor: meta?.pageScaleFactor ?? 1,
      buffer: Buffer.from(raw.data, 'base64'),
    });
  };

  client.on('Page.screencastFrame', onScreencastFrame);

  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  await client.send('Page.startScreencast', {
    format: options.format ?? 'png',
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
    everyNthFrame: options.everyNthFrame ?? 1,
    maxWidth: options.maxWidth ?? viewport.width,
    maxHeight: options.maxHeight ?? viewport.height,
  });

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    await client.send('Page.stopScreencast').catch(() => {});
    client.off('Page.screencastFrame', onScreencastFrame);
    await owned.release();

    stream.end();
  };

  return { frames: stream.iterable, stop, stats: stream.stats };
}
