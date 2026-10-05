import { describe, expect, it } from 'vitest';
import { createFakeCdpTransport } from '@openuji/cdp/testing';
import type { LifecycleEvent } from '@openuji/core';
import { createLifecycleStream } from '@openuji/stream-lifecycle';
import {
  collect,
  frameNavigated,
  lifecycleEvent,
  navigatedWithinDocument,
  replayOnEnable,
  showingDocument,
} from '../../cdp/test/events.js';

/** Compact view: what happened, and to which frame. */
function summarize(events: readonly LifecycleEvent[]): string[] {
  return events.map(
    (e) =>
      `${e.type === 'milestone' ? e.name : e.sameDocument ? 'navigated (same document)' : e.type} ` +
      `${e.loaderId} ${e.isMainFrame ? 'main' : 'sub'}`,
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
      'navigated loader-a main',
      'navigated loader-sub sub',
      'DOMContentLoaded loader-a main',
      'load loader-sub sub',
    ]);
  });

  it("reports a loaded page's document, but not the milestones it had already reached", async () => {
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
      'navigated loader-now main',
      'networkIdle loader-now main',
    ]);
  });

  it("does not report a fresh tab's about:blank, but knows its frame is the main one", async () => {
    const cdp = createFakeCdpTransport();
    showingDocument(cdp, 'blank', 'about:blank');
    replayOnEnable(cdp, () => {
      lifecycleEvent(cdp, 'commit', 'blank');
      lifecycleEvent(cdp, 'load', 'blank');
    });

    const { events, stop } = await createLifecycleStream(cdp);
    // `init` of the navigation away arrives before `navigated`.
    lifecycleEvent(cdp, 'init', 'loader-a');
    frameNavigated(cdp, 'loader-a');
    lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-a');
    await stop();

    expect(summarize(await collect(events))).toEqual([
      'init loader-a main',
      'navigated loader-a main',
      'DOMContentLoaded loader-a main',
    ]);
  });

  it('reports same-document navigations under the document they keep', async () => {
    const cdp = createFakeCdpTransport();
    const { events, stop } = await createLifecycleStream(cdp);

    frameNavigated(cdp, 'loader-a', { url: 'https://app.example/' });
    navigatedWithinDocument(cdp, 'https://app.example/inbox');
    frameNavigated(cdp, 'loader-sub', { frameId: 'child', parentId: 'main' });
    navigatedWithinDocument(cdp, 'https://ads.example/#slot', {
      frameId: 'child',
      navigationType: 'fragment',
    });
    await stop();

    expect(await collect(events)).toMatchObject([
      { type: 'navigated', loaderId: 'loader-a', sameDocument: false },
      {
        type: 'navigated',
        frameId: 'main',
        isMainFrame: true,
        loaderId: 'loader-a',
        url: 'https://app.example/inbox',
        sameDocument: true,
        navigationType: 'historyApi',
      },
      { type: 'navigated', loaderId: 'loader-sub', sameDocument: false },
      {
        type: 'navigated',
        frameId: 'child',
        isMainFrame: false,
        loaderId: 'loader-sub',
        sameDocument: true,
        navigationType: 'fragment',
      },
    ]);
  });

  it('knows the documents showing at attach, subframes included', async () => {
    const cdp = createFakeCdpTransport();
    cdp.respond('Page.getFrameTree', {
      frameTree: {
        frame: { id: 'main', loaderId: 'loader-now', url: 'https://app.example/' },
        childFrames: [
          { frame: { id: 'child', parentId: 'main', loaderId: 'loader-sub', url: 'https://ads.example/' } },
        ],
      },
    } as never);

    const { events, stop } = await createLifecycleStream(cdp);
    navigatedWithinDocument(cdp, 'https://app.example/inbox');
    navigatedWithinDocument(cdp, 'https://ads.example/#2', { frameId: 'child' });
    await stop();

    expect(summarize(await collect(events))).toEqual([
      'navigated loader-now main',
      'navigated (same document) loader-now main',
      'navigated (same document) loader-sub sub',
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
      // The document showing at attach comes from a command response, not an
      // event: it is stamped with the transport's clock at attach.
      { type: 'navigated', loaderId: 'loader-now', receivedAtMs: 1_000 },
      { type: 'navigated', loaderId: 'loader-a', receivedAtMs: 1_050 },
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
