import type { CDPSession, Page } from 'playwright';
import {
  createPushStream,
  ownSession,
  type LifecycleEvent,
  type PushStreamStats,
} from '@uxr/core';

export interface LifecycleStreamHandle {
  events: AsyncIterable<LifecycleEvent>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Streams navigation lifecycle events from CDP.
 *
 * Tracks `loaderId` identity, main-frame boundaries, and paint milestones.
 * Events here are the arming signals the document rules latch on, so this
 * stream is never allowed to drop.
 */
export async function createLifecycleStream(
  page: Page,
  existingClient?: CDPSession,
): Promise<LifecycleStreamHandle> {
  const owned = ownSession(
    existingClient ?? (await page.context().newCDPSession(page)),
    !existingClient,
  );
  const client = owned.session;

  const stream = createPushStream<LifecycleEvent>();
  let mainFrameId: string | null = null;

  // 1. Frame navigations identify new document commits and their loaderIds.
  const onFrameNavigated = (raw: {
    frame: { id: string; parentId?: string; loaderId: string; url: string };
  }): void => {
    if (stream.closed) return;

    const { frame } = raw;
    const isMainFrame = !frame.parentId;
    if (isMainFrame) {
      mainFrameId = frame.id;
    }

    stream.push({
      type: 'committed',
      frameId: frame.id,
      isMainFrame,
      loaderId: frame.loaderId,
      url: frame.url,
      timestamp: Date.now() / 1000,
    });
  };

  // 2. Lifecycle milestones: commit, DOMContentLoaded, load, paints, idle.
  const onLifecycleEvent = (raw: {
    frameId: string;
    loaderId: string;
    name: string;
    timestamp: number;
  }): void => {
    if (stream.closed) return;

    stream.push({
      type: 'milestone',
      frameId: raw.frameId,
      isMainFrame: mainFrameId ? raw.frameId === mainFrameId : false,
      loaderId: raw.loaderId,
      name: raw.name,
      timestamp: raw.timestamp,
    });
  };

  client.on('Page.frameNavigated', onFrameNavigated);
  client.on('Page.lifecycleEvent', onLifecycleEvent);

  await client.send('Page.enable');
  await client.send('Page.setLifecycleEventsEnabled', { enabled: true });

  // Bootstrap the currently active root frame: attaching mid-session would
  // otherwise leave the engine without a current document until the next
  // navigation.
  const tree = await client.send('Page.getFrameTree').catch(() => null);
  const root = tree?.frameTree?.frame;
  if (root?.id) {
    mainFrameId = root.id;
    if (root.loaderId && root.url && root.url !== 'about:blank') {
      stream.push({
        type: 'committed',
        frameId: root.id,
        isMainFrame: true,
        loaderId: root.loaderId,
        url: root.url,
        timestamp: Date.now() / 1000,
      });
    }
  }

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    await client
      .send('Page.setLifecycleEventsEnabled', { enabled: false })
      .catch(() => {});
    client.off('Page.frameNavigated', onFrameNavigated);
    client.off('Page.lifecycleEvent', onLifecycleEvent);
    await owned.release();

    stream.end();
  };

  return { events: stream.iterable, stop, stats: stream.stats };
}
