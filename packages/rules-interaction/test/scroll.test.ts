import { describe, expect, it } from 'vitest';
import type { DomainEvent, MilestoneCapture } from '@openuji/core';
import { RulesEngine } from '@openuji/engine';
import { SCROLL_DEFAULTS, scrollLifecycleRule } from '@openuji/rules-interaction';
import {
  frameEvent,
  navigated,
  position,
  scrollEnd,
  scrollInput,
  scrollStart,
  withinDocument,
} from '../../engine/test/helpers.js';

function run(events: readonly DomainEvent[]): MilestoneCapture[] {
  const engine = new RulesEngine([scrollLifecycleRule()]);
  return events.flatMap((event) => [...engine.processEvent(event)]);
}

/** Frames that hold position, enough to satisfy the settle hysteresis. */
function stationary(scrollY: number, count: number): DomainEvent[] {
  return Array.from({ length: count }, () => frameEvent({ scrollY }));
}

const labels = (captures: readonly MilestoneCapture[]) => captures.map((c) => c.label);

describe('scrollLifecycleRule: the page, by its frames', () => {
  it('ignores jitter below the intentional-scroll threshold', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: SCROLL_DEFAULTS.minIntentionalScrollPx - 1 }),
      frameEvent({ scrollY: 0 }),
    ]);

    expect(captures).toEqual([]);
  });

  it('captures the resting frame before an episode and the settled frame after', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 600 }),
      ...stationary(600, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    expect(captures[0]?.frame.scrollY).toBe(0);
    expect(captures[1]?.frame.scrollY).toBe(600);
    expect(captures[1]?.detail).toContain('+600px');
  });

  it('does not settle before the stationary-frame count is reached', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 400 }),
      ...stationary(400, SCROLL_DEFAULTS.requiredStationaryFrames - 1),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01']);
  });

  it('treats a mid-fling pause shorter than the hysteresis as one episode', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 200 }),
      frameEvent({ scrollY: 200 }), // brief stall
      frameEvent({ scrollY: 500 }), // fling continues
      ...stationary(500, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
  });

  it('settles immediately on the authoritative DOM scrollend', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 250 }),
      scrollEnd(),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    expect(captures[1]?.detail).toContain('via scrollend');
  });

  it('emits one post-scroll per episode even when both signals arrive', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 250 }),
      scrollEnd(),
      ...stationary(250, SCROLL_DEFAULTS.requiredStationaryFrames * 2),
    ]);

    expect(captures.filter((c) => c.label.startsWith('04-'))).toHaveLength(1);
  });

  it('numbers successive episodes', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }),
      scrollEnd(),
      scrollInput(),
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 900 }),
      scrollEnd(),
    ]);

    expect(labels(captures)).toEqual([
      '03-pre-scroll-01',
      '04-post-scroll-01',
      '03-pre-scroll-02',
      '04-post-scroll-02',
    ]);
  });

  it('honours tuned thresholds', () => {
    const engine = new RulesEngine([
      scrollLifecycleRule({ minIntentionalScrollPx: 400 }),
    ]);

    const captures = [
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }), // below the raised threshold
    ].flatMap((event) => [...engine.processEvent(event)]);

    expect(captures).toEqual([]);
  });
});

describe('scrollLifecycleRule: who scrolled', () => {
  it("captures a scroll with no input behind it as the page's own", () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      // A router's scroll reset, a scroll to an error: one jump, no input.
      frameEvent({ scrollY: 800 }),
      ...stationary(800, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(labels(captures)).toEqual(['05-pre-auto-scroll-01', '06-post-auto-scroll-01']);
    expect(captures[0]?.frame.scrollY).toBe(0);
    expect(captures[1]?.frame.scrollY).toBe(800);
    expect(captures[1]?.scrollEpisode).toMatchObject({ origin: 'auto' });
    expect(captures[1]?.scrollEpisode?.input).toBeUndefined();
  });

  it('promotes an episode to the user when input arrives after the motion has started', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      // The compositor painted the scroll before the wheel reached the page.
      frameEvent({ scrollY: 120 }),
      scrollInput('wheel'),
      frameEvent({ scrollY: 300 }),
      ...stationary(300, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    // Still the frame before the motion, not the one the input arrived on.
    expect(captures[0]?.frame.scrollY).toBe(0);
    expect(captures[1]?.scrollEpisode).toMatchObject({ origin: 'user', input: 'wheel' });
  });

  it('lets input go stale', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput('key'),
      ...stationary(0, SCROLL_DEFAULTS.inputFreshFrames + 1),
      frameEvent({ scrollY: 500 }),
      ...stationary(500, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(labels(captures)).toEqual(['05-pre-auto-scroll-01', '06-post-auto-scroll-01']);
  });

  it("spends input on one episode: the page's scroll right after is its own", () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }),
      scrollEnd(),
      // Within the input's freshness, but no new input: scroll anchoring, say.
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 340 }),
      scrollEnd(),
    ]);

    expect(labels(captures)).toEqual([
      '03-pre-scroll-01',
      '04-post-scroll-01',
      '05-pre-auto-scroll-01',
      '06-post-auto-scroll-01',
    ]);
  });

  it('numbers user and page episodes apart', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 800 }),
      scrollEnd(),
      scrollInput(),
      frameEvent({ scrollY: 800 }),
      frameEvent({ scrollY: 1200 }),
      scrollEnd(),
    ]);

    expect(labels(captures)).toEqual([
      '05-pre-auto-scroll-01',
      '06-post-auto-scroll-01',
      '03-pre-scroll-01',
      '04-post-scroll-01',
    ]);
  });
});

describe('scrollLifecycleRule: any scroller, by the probe', () => {
  it('captures an element scrolling on its own, which the frames cannot see', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput('wheel'),
      scrollStart('div#pane', position(0)),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      ...stationary(0, SCROLL_DEFAULTS.requiredStationaryFrames * 2),
      scrollEnd('div#pane', position(640)),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    expect(captures[0]?.domTarget?.selector).toBe('div#pane');
    expect(captures[0]?.detail).toContain('approximate');
    expect(captures[1]?.scrollEpisode).toEqual({
      scroller: expect.objectContaining({ selector: 'div#pane' }),
      origin: 'user',
      input: 'wheel',
      from: position(0),
      to: position(640),
    });
    expect(captures[1]?.detail).toContain('<div#pane> settled at (0, 640) (delta: +640px via scrollend)');
  });

  it("does not settle on another scroller's scrollend", () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }),
      scrollEnd('div#pane'),
      scrollEnd('window', position(300)),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    expect(captures[1]?.scrollEpisode?.to).toEqual(position(300));
  });

  it('waits for the scrollend once the probe has reported the page, and keeps its positions', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 200 }),
      scrollStart('window', position(0)),
      // A pause the hysteresis would call settled; the browser says otherwise.
      ...stationary(200, SCROLL_DEFAULTS.requiredStationaryFrames * 2),
      frameEvent({ scrollY: 500 }),
      scrollEnd('window', position(500)),
    ]);

    expect(labels(captures)).toEqual(['03-pre-scroll-01', '04-post-scroll-01']);
    expect(captures[1]?.scrollEpisode).toMatchObject({ from: position(0), to: position(500) });
  });

  it('opens a page episode from the probe alone, where frame offsets read 0', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      scrollStart('window', position(0)),
      frameEvent({ scrollY: 0 }),
      scrollEnd('window', position(800)),
    ]);

    expect(labels(captures)).toEqual(['05-pre-auto-scroll-01', '06-post-auto-scroll-01']);
    expect(captures[1]?.detail).toContain('settled at (0, 800) (delta: +800px via scrollend)');
  });

  it('settles the open episode when another scroller takes over', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      scrollStart('div#menu', position(0)),
      frameEvent({ scrollY: 0 }),
      // The menu was removed mid-scroll: its scrollend never comes.
      scrollInput(),
      scrollStart('div#pane', position(0)),
      frameEvent({ scrollY: 0 }),
      scrollEnd('div#pane', position(90)),
    ]);

    expect(
      captures.map((c) => `${c.label} ${c.domTarget?.selector}`),
    ).toEqual([
      '03-pre-scroll-01 div#menu',
      '04-post-scroll-01 div#menu',
      '03-pre-scroll-02 div#pane',
      '04-post-scroll-02 div#pane',
    ]);
    expect(captures[1]?.detail).toContain('another scroller took over');
  });
});

describe('scrollLifecycleRule: across views', () => {
  it('settles an open episode before the view changes, and numbers from 01 after', () => {
    const captures = run([
      navigated('loader-a', 'https://app.example/'),
      frameEvent({ scrollY: 0 }),
      scrollInput(),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }),
      withinDocument('https://app.example/b'),
      frameEvent({ scrollY: 300 }),
      scrollInput(),
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 700 }),
      scrollEnd(),
    ]);

    expect(captures.map((c) => `${c.viewId} ${c.label}`)).toEqual([
      '1 03-pre-scroll-01',
      '1 04-post-scroll-01',
      '2 03-pre-scroll-01',
      '2 04-post-scroll-01',
    ]);
    expect(captures[1]?.detail).toContain('cut short by navigation');
  });

  it("settles the page's own scroll still open when the session ends", () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 400 }),
      { type: 'stop' },
    ]);

    expect(labels(captures)).toEqual(['05-pre-auto-scroll-01', '06-post-auto-scroll-01']);
    expect(captures[1]?.detail).toContain('cut short by session end');
  });
});
