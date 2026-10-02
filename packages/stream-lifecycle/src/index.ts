import type { CdpTransport, Detach } from '@openuji/cdp';
import {
  createPushStream,
  type LifecycleEvent,
  type PushStreamStats,
} from '@openuji/core';

export interface LifecycleStreamHandle {
  events: AsyncIterable<LifecycleEvent>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Attaches the lifecycle source: navigation commits and lifecycle milestones,
 * emitted synchronously from inside the CDP event handlers.
 *
 * Tracks `loaderId` identity, main-frame boundaries, and paint milestones.
 * Shared by the standalone stream and the fused orchestrator.
 */
export async function attachLifecycle(
  cdp: CdpTransport,
  emit: (event: LifecycleEvent) => void,
): Promise<Detach> {
  let mainFrameId: string | null = null;

  // 1. Frame navigations identify new document commits and their loaderIds.
  const offNavigated = cdp.on('Page.frameNavigated', ({ frame }) => {
    const isMainFrame = !frame.parentId;
    if (isMainFrame) {
      mainFrameId = frame.id;
    }

    emit({
      type: 'committed',
      frameId: frame.id,
      isMainFrame,
      loaderId: frame.loaderId,
      url: frame.url,
      timestamp: Date.now() / 1000,
    });
  });

  // 2. Lifecycle milestones: commit, DOMContentLoaded, load, paints, idle.
  const offLifecycle = cdp.on('Page.lifecycleEvent', (raw) => {
    emit({
      type: 'milestone',
      frameId: raw.frameId,
      isMainFrame: mainFrameId ? raw.frameId === mainFrameId : false,
      loaderId: raw.loaderId,
      name: raw.name,
      timestamp: raw.timestamp,
    });
  });

  const unsubscribe = (): void => {
    offNavigated();
    offLifecycle();
  };

  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
  } catch (err) {
    unsubscribe();
    throw err;
  }

  // Bootstrap the currently active root frame: attaching mid-session would
  // otherwise leave the engine without a current document until the next
  // navigation.
  const tree = await cdp.send('Page.getFrameTree').catch(() => null);
  const root = tree?.frameTree?.frame;
  if (root?.id) {
    mainFrameId = root.id;
    if (root.loaderId && root.url && root.url !== 'about:blank') {
      emit({
        type: 'committed',
        frameId: root.id,
        isMainFrame: true,
        loaderId: root.loaderId,
        url: root.url,
        timestamp: Date.now() / 1000,
      });
    }
  }

  let detached = false;
  return async () => {
    if (detached) return;
    detached = true;

    await cdp
      .send('Page.setLifecycleEventsEnabled', { enabled: false })
      .catch(() => {});
    unsubscribe();
  };
}

/**
 * Streams navigation lifecycle events from CDP, on its own — no orchestrator,
 * no sibling streams. Leaves the transport to its owner.
 *
 * Events here are the arming signals the document rules latch on, so this
 * stream is never allowed to drop.
 */
export async function createLifecycleStream(
  cdp: CdpTransport,
): Promise<LifecycleStreamHandle> {
  const stream = createPushStream<LifecycleEvent>();

  const detach = await attachLifecycle(cdp, (event) => stream.push(event));

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    await detach();
    stream.end();
  };

  return { events: stream.iterable, stop, stats: stream.stats };
}
