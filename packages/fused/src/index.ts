import type { CDPSession, Page } from 'playwright';
import {
  createPushStream,
  ownSession,
  type CompositorFrame,
  type DomainEvent,
  type PushStreamStats,
} from '@uxr/core';
import { createCompositorStream } from '@uxr/stream-compositor';
import { createLifecycleStream } from '@uxr/stream-lifecycle';
import { createInteractionStream } from '@uxr/stream-interaction';

export * from './default-rules.js';

export interface FusedStreamOptions {
  /**
   * Cap on domain events queued but not yet consumed.
   *
   * Only compositor frames are ever evicted — lifecycle and interaction events
   * are the signals rules arm on, and losing one silently corrupts a recording.
   * Omit for an unbounded queue (the default). Bounding the compositor stream
   * alone is not enough, because its frames are re-queued here.
   */
  maxPendingEvents?: number;
  /** Called for each dropped frame once `maxPendingEvents` is exceeded. */
  onDropFrame?: (frame: CompositorFrame, totalDropped: number) => void;
}

export interface FusedStreamHandle {
  events: AsyncIterable<DomainEvent>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Fuses the three independent CDP streams into one ordered domain event stream.
 *
 * Two things here are the whole design:
 *
 *  1. **One CDP session.** All three streams attach to a single session this
 *     function owns (unless one is passed in), so they share one transport and
 *     one teardown.
 *  2. **One FIFO queue.** Three consumer loops push into a single queue, so the
 *     order events reach the engine is exactly the order they arrived from
 *     Chromium. That ordering *is* the fusion: rules are written as "capture the
 *     next compositor frame after this lifecycle notification" and "the resting
 *     frame before this click". Any per-stream buffering, priority, or
 *     round-robin merge would silently capture different moments.
 */
export async function createFusedStream(
  page: Page,
  options: FusedStreamOptions = {},
  client?: CDPSession,
): Promise<FusedStreamHandle> {
  const owned = ownSession(
    client ?? (await page.context().newCDPSession(page)),
    !client,
  );
  const cdpClient = owned.session;

  const { maxPendingEvents, onDropFrame } = options;

  const stream = createPushStream<DomainEvent>({
    ...(maxPendingEvents !== undefined ? { capacity: maxPendingEvents } : {}),
    evict: (event) => event.type === 'frame',
    onDrop: (event, total) => {
      if (event.type === 'frame') onDropFrame?.(event.frame, total);
    },
  });

  const [compositor, lifecycle, interaction] = await Promise.all([
    createCompositorStream(page, {}, cdpClient),
    createLifecycleStream(page, cdpClient),
    createInteractionStream(page, cdpClient),
  ]);

  const pumpFrames = (async () => {
    for await (const frame of compositor.frames) {
      if (stream.closed) break;
      stream.push({ type: 'frame', frame });
    }
  })();

  const pumpLifecycle = (async () => {
    for await (const event of lifecycle.events) {
      if (stream.closed) break;

      stream.push(
        event.type === 'committed'
          ? {
              type: 'committed',
              frameId: event.frameId,
              isMainFrame: event.isMainFrame,
              loaderId: event.loaderId,
              url: event.url,
              timestamp: event.timestamp,
            }
          : {
              type: 'lifecycle',
              frameId: event.frameId,
              loaderId: event.loaderId,
              name: event.name,
              timestamp: event.timestamp,
            },
      );
    }
  })();

  const pumpInteractions = (async () => {
    for await (const event of interaction.events) {
      if (stream.closed) break;
      stream.push({
        type: 'interaction',
        action: event.action,
        target: event.target,
        timestamp: event.timestamp,
      });
    }
  })();

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    await Promise.all([
      compositor.stop().catch(() => {}),
      lifecycle.stop().catch(() => {}),
      interaction.stop().catch(() => {}),
    ]);

    await Promise.all([pumpFrames, pumpLifecycle, pumpInteractions]).catch(
      () => {},
    );

    await owned.release();

    stream.end();
  };

  return { events: stream.iterable, stop, stats: stream.stats };
}
