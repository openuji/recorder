import { describe, expect, it } from 'vitest';
import { createFakeCdpTransport } from '@openuji/cdp/testing';
import { createLifecycleStream } from '@openuji/stream-lifecycle';
import {
  collect,
  frameNavigated,
  lifecycleEvent,
} from '../../cdp/test/events.js';

describe('createLifecycleStream (standalone)', () => {
  it('enables lifecycle events and maps commits and milestones', async () => {
    const cdp = createFakeCdpTransport();
    const { events, stop } = await createLifecycleStream(cdp);

    frameNavigated(cdp, 'loader-a');
    frameNavigated(cdp, 'loader-sub', { frameId: 'child', parentId: 'main' });
    lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-a');
    lifecycleEvent(cdp, 'load', 'loader-sub', 'child');
    await stop();

    expect(cdp.sentMethods().slice(0, 3)).toEqual([
      'Page.enable',
      'Page.setLifecycleEventsEnabled',
      'Page.getFrameTree',
    ]);
    expect(
      (await collect(events)).map((e) =>
        e.type === 'committed'
          ? ['committed', e.loaderId, e.isMainFrame]
          : ['milestone', e.name, e.isMainFrame],
      ),
    ).toEqual([
      ['committed', 'loader-a', true],
      ['committed', 'loader-sub', false],
      ['milestone', 'DOMContentLoaded', true],
      ['milestone', 'load', false],
    ]);
  });

  it('bootstraps the document already showing when it attaches', async () => {
    const cdp = createFakeCdpTransport();
    cdp.respond('Page.getFrameTree', {
      frameTree: {
        frame: { id: 'root', loaderId: 'loader-now', url: 'https://example.com/now' },
      },
    } as never);

    const { events, stop } = await createLifecycleStream(cdp);
    lifecycleEvent(cdp, 'load', 'loader-now', 'root');
    await stop();

    expect(await collect(events)).toMatchObject([
      { type: 'committed', frameId: 'root', isMainFrame: true, loaderId: 'loader-now' },
      { type: 'milestone', name: 'load', isMainFrame: true },
    ]);
  });

  it('does not bootstrap about:blank', async () => {
    const cdp = createFakeCdpTransport();
    cdp.respond('Page.getFrameTree', {
      frameTree: { frame: { id: 'root', loaderId: 'blank', url: 'about:blank' } },
    } as never);

    const { events, stop } = await createLifecycleStream(cdp);
    await stop();

    expect(await collect(events)).toEqual([]);
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
