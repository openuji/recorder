import type {
  CdpEventMeta,
  CdpEventParams,
  CdpTransport,
  Detach,
  Unsubscribe,
} from '@openuji/cdp';
import {
  createPushStream,
  type LifecycleEvent,
  type PushStreamStats,
} from '@openuji/core';

type Frame = CdpEventParams<'Page.frameNavigated'>['frame'];
type RawMilestone = CdpEventParams<'Page.lifecycleEvent'>;

export interface LifecycleStreamHandle {
  events: AsyncIterable<LifecycleEvent>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Attaches the lifecycle source: navigation commits and lifecycle milestones,
 * emitted synchronously from inside the CDP event handlers.
 *
 * Attaching runs in a fixed order:
 *  1. Read the frame tree, so the main frame is known before the first
 *     milestone arrives, and report the document already showing.
 *  2. Enable lifecycle reporting. Chromium first replays the milestones that
 *     document already reached; those are tagged `replayed`.
 *  3. Listen for live milestones.
 */
export async function attachLifecycle(
  cdp: CdpTransport,
  emit: (event: LifecycleEvent) => void,
): Promise<Detach> {
  const page = trackPage();

  const milestones =
    (replayed: boolean) =>
    (raw: RawMilestone, { receivedAtMs }: CdpEventMeta): void => {
      const event = page.milestone(raw, receivedAtMs, replayed);
      if (event) emit(event);
    };

  const offCommits = cdp.on('Page.frameNavigated', ({ frame }, { receivedAtMs }) =>
    emit(page.committed(frame, receivedAtMs)),
  );

  try {
    await cdp.send('Page.enable');

    const tree = await cdp.send('Page.getFrameTree').catch(() => null);
    const current = page.adopt(tree?.frameTree?.frame, cdp.now());
    if (current) emit(current);

    // Chromium replays before it acknowledges, so the replay is exactly what
    // arrives while the command is in flight. A live event racing into that
    // one round trip (a navigation already under way) is tagged replayed too.
    await during(
      () => cdp.on('Page.lifecycleEvent', milestones(true)),
      () => cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }),
    );
  } catch (err) {
    offCommits();
    throw err;
  }

  const offLive = cdp.on('Page.lifecycleEvent', milestones(false));

  return async () => {
    await cdp
      .send('Page.setLifecycleEventsEnabled', { enabled: false })
      .catch(() => {});
    offCommits();
    offLive();
  };
}

/**
 * What the source knows about the page, and how raw CDP events become
 * lifecycle events given that knowledge. No I/O, no clock.
 */
function trackPage() {
  let mainFrameId: string | null = null;
  /** A fresh tab's blank start page: nobody navigated to it, so it is silenced. */
  let blankLoaderId: string | null = null;

  const committed = (frame: Frame, receivedAtMs: number): LifecycleEvent => {
    if (!frame.parentId) mainFrameId = frame.id;

    return {
      type: 'committed',
      frameId: frame.id,
      isMainFrame: !frame.parentId,
      loaderId: frame.loaderId,
      url: frame.url,
      receivedAtMs,
    };
  };

  return {
    committed,

    /**
     * Takes over the root frame showing at attach. Returns its commit, so the
     * engine has a current document straight away — or `null` for a blank
     * start page.
     */
    adopt(root: Frame | undefined, receivedAtMs: number): LifecycleEvent | null {
      if (!root) return null;
      if (root.url !== 'about:blank') return committed(root, receivedAtMs);

      mainFrameId = root.id;
      blankLoaderId = root.loaderId;
      return null;
    },

    milestone(
      raw: RawMilestone,
      receivedAtMs: number,
      replayed: boolean,
    ): LifecycleEvent | null {
      if (raw.loaderId === blankLoaderId) return null;

      return {
        type: 'milestone',
        frameId: raw.frameId,
        isMainFrame: raw.frameId === mainFrameId,
        loaderId: raw.loaderId,
        name: raw.name,
        receivedAtMs,
        monotonicTime: raw.timestamp,
        replayed,
      };
    },
  };
}

/** Holds a subscription for exactly as long as `command` is in flight. */
async function during(
  subscribe: () => Unsubscribe,
  command: () => Promise<unknown>,
): Promise<void> {
  const unsubscribe = subscribe();
  try {
    await command();
  } finally {
    unsubscribe();
  }
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
