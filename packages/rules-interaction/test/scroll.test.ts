import { describe, expect, it } from 'vitest';
import type { DomainEvent, MilestoneCapture } from '@openuji/core';
import { RulesEngine } from '@openuji/engine';
import { SCROLL_DEFAULTS, scrollLifecycleRule } from '@openuji/rules-interaction';
import { navigated, frameEvent, scrollEnd } from '../../engine/test/helpers.js';

function run(events: readonly DomainEvent[]): MilestoneCapture[] {
  const engine = new RulesEngine([scrollLifecycleRule()]);
  return events.flatMap((event) => [...engine.processEvent(event)]);
}

/** Frames that hold position, enough to satisfy the settle hysteresis. */
function stationary(scrollY: number, count: number): DomainEvent[] {
  return Array.from({ length: count }, () => frameEvent({ scrollY }));
}

describe('scrollLifecycleRule', () => {
  it('ignores jitter below the intentional-scroll threshold', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
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
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 600 }),
      ...stationary(600, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '03-pre-scroll-01',
      '04-post-scroll-01',
    ]);
    expect(captures[0]?.frame.scrollY).toBe(0);
    expect(captures[1]?.frame.scrollY).toBe(600);
    expect(captures[1]?.detail).toContain('+600px');
  });

  it('does not settle before the stationary-frame count is reached', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 400 }),
      ...stationary(400, SCROLL_DEFAULTS.requiredStationaryFrames - 1),
    ]);

    expect(captures.map((c) => c.label)).toEqual(['03-pre-scroll-01']);
  });

  it('treats a mid-fling pause shorter than the hysteresis as one episode', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 200 }),
      frameEvent({ scrollY: 200 }), // brief stall
      frameEvent({ scrollY: 500 }), // fling continues
      ...stationary(500, SCROLL_DEFAULTS.requiredStationaryFrames),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '03-pre-scroll-01',
      '04-post-scroll-01',
    ]);
  });

  it('settles immediately on the authoritative DOM scrollend', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 250 }),
      scrollEnd(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '03-pre-scroll-01',
      '04-post-scroll-01',
    ]);
    expect(captures[1]?.detail).toContain('via scrollend');
  });

  it('emits one post-scroll per episode even when both signals arrive', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 0 }),
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
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }),
      scrollEnd(),
      frameEvent({ scrollY: 300 }),
      frameEvent({ scrollY: 900 }),
      scrollEnd(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
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
      frameEvent({ scrollY: 0 }),
      frameEvent({ scrollY: 300 }), // below the raised threshold
    ].flatMap((event) => [...engine.processEvent(event)]);

    expect(captures).toEqual([]);
  });
});
