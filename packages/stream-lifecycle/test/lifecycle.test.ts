import { describe, expect, it } from 'vitest';
import { createFakeCdpTransport } from '@openuji/cdp/testing';
import type { LifecycleEvent } from '@openuji/core';
import { createLifecycleStream } from '@openuji/stream-lifecycle';
import {
  collect,
  frameNavigated,
  lifecycleEvent,
  replayOnEnable,
  showingDocument,
} from '../../cdp/test/events.js';

/** Compact view: what happened, to whom, and whether it was replayed. */
function summarize(events: readonly LifecycleEvent[]): string[] {
  return events.map((e) =>
    e.type === 'committed'
      ? `committed ${e.loaderId} ${e.isMainFrame ? 'main' : 'sub'}`
      : `${e.name} ${e.loaderId} ${e.isMainFrame ? 'main' : 'sub'}` +
        (e.replayed ? ' replayed' : ''),
  );
}

describe('createLifecycleStream (standalone)', () => {
  it('learns the main frame before enabling lifecycle reporting', async () => {
    const cdp = createFakeCdpTransport();
    await createLifecycleStream(cdp);

    expect(cdp.sentMethods()).toEqual([
      'Page.enable',
      'Page.getFrameTree',
      'Page.setLifecycleEventsEnabled',
    ]);
  });

  it('maps live commits and milestones, telling the main frame from subframes', async () => {
    const cdp = createFakeCdpTransport();
    const { events, stop } = await createLifecycleStream(cdp);

    frameNavigated(cdp, 'loader-a');
    frameNavigated(cdp, 'loader-sub', { frameId: 'child', parentId: 'main' });
    lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-a');
    lifecycleEvent(cdp, 'load', 'loader-sub', 'child');
    await stop();

    expect(summarize(await collect(events))).toEqual([
      'committed loader-a main',
      'committed loader-sub sub',
      'DOMContentLoaded loader-a main',
      'load loader-sub sub',
    ]);
  });

  it('bootstraps a loaded page, then tags its replayed milestones as main-frame replays', async () => {
    const cdp = createFakeCdpTransport();
    showingDocument(cdp, 'loader-now');
    replayOnEnable(cdp, () => {
      lifecycleEvent(cdp, 'commit', 'loader-now');
      lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-now');
      lifecycleEvent(cdp, 'networkAlmostIdle', 'loader-now');
    });

    const { events, stop } = await createLifecycleStream(cdp);
    lifecycleEvent(cdp, 'networkIdle', 'loader-now');
    await stop();

    expect(summarize(await collect(events))).toEqual([
      'committed loader-now main',
      'commit loader-now main replayed',
      'DOMContentLoaded loader-now main replayed',
      'networkAlmostIdle loader-now main replayed',
      'networkIdle loader-now main',
    ]);
  });

  it("silences the initial about:blank document, replay and all, but not what comes next", async () => {
    const cdp = createFakeCdpTransport();
    showingDocument(cdp, 'blank', 'about:blank');
    replayOnEnable(cdp, () => {
      lifecycleEvent(cdp, 'commit', 'blank');
      lifecycleEvent(cdp, 'load', 'blank');
    });

    const { events, stop } = await createLifecycleStream(cdp);
    lifecycleEvent(cdp, 'networkIdle', 'blank'); // late, still the blank document
    lifecycleEvent(cdp, 'init', 'loader-a');
    frameNavigated(cdp, 'loader-a');
    lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-a');
    await stop();

    expect(summarize(await collect(events))).toEqual([
      'init loader-a main',
      'committed loader-a main',
      'DOMContentLoaded loader-a main',
    ]);
  });

  it("stamps receipt on the transport's clock, keeping Chromium's in its own field", async () => {
    const cdp = createFakeCdpTransport({ startAtMs: 1_000 });
    showingDocument(cdp, 'loader-now');
    const { events, stop } = await createLifecycleStream(cdp);

    cdp.advance(50);
    frameNavigated(cdp, 'loader-a');
    cdp.advance(25);
    lifecycleEvent(cdp, 'load', 'loader-a', 'main', 405_123.25);
    await stop();

    expect(await collect(events)).toMatchObject([
      // The bootstrap commit comes from a command response, not an event: it
      // is stamped with the transport's clock at attach.
      { type: 'committed', loaderId: 'loader-now', receivedAtMs: 1_000 },
      { type: 'committed', loaderId: 'loader-a', receivedAtMs: 1_050 },
      { type: 'milestone', receivedAtMs: 1_075, monotonicTime: 405_123.25 },
    ]);
  });

  it('disables lifecycle events, unsubscribes and ends on stop', async () => {
    const cdp = createFakeCdpTransport();
    const { events, stop } = await createLifecycleStream(cdp);

    await stop();

    expect(cdp.sent.at(-1)).toEqual({
      method: 'Page.setLifecycleEventsEnabled',
      params: { enabled: false },
    });
    expect(cdp.listenerCount()).toBe(0);
    expect(await collect(events)).toEqual([]);
  });
});
