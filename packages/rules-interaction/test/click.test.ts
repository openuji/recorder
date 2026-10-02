import { describe, expect, it } from 'vitest';
import type { DomainEvent, MilestoneCapture } from '@openuji/core';
import { RulesEngine, type MilestoneRule } from '@openuji/engine';
import { ClickEpisodeRule } from '@openuji/rules-interaction';
import {
  click,
  navigated,
  frameEvent,
} from '../../engine/test/helpers.js';

function run(
  events: readonly DomainEvent[],
  rules: readonly MilestoneRule[] = [ClickEpisodeRule],
): MilestoneCapture[] {
  const engine = new RulesEngine(rules);
  return events.flatMap((event) => [...engine.processEvent(event)]);
}

function episodeOf(label: string): string {
  return label.slice(label.lastIndexOf('-') + 1);
}

describe('ClickEpisodeRule', () => {
  it('pairs a pre- and post-click capture around each click', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent(),
      click('button#go'),
      frameEvent(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '10-pre-click-01',
      '11-post-click-01',
    ]);
  });

  it('numbers successive clicks independently', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent(),
      click(),
      frameEvent(),
      click(),
      frameEvent(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '10-pre-click-01',
      '11-post-click-01',
      '10-pre-click-02',
      '11-post-click-02',
    ]);
  });

  /**
   * Regression: pre- and post-click used to be two rules with two counters and
   * different increment conditions. A click before the first compositor frame
   * incremented only the post counter, so every later pair was mismatched.
   */
  it('keeps pre/post episode numbers paired after a click with no prior frame', () => {
    const captures = run([
      navigated('loader-a'),
      click('a#early'), // no frame seen yet: nothing to show as "before"
      frameEvent(),
      click('a#later'),
      frameEvent(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '11-post-click-01',
      '10-pre-click-02',
      '11-post-click-02',
    ]);

    const pre = captures.find((c) => c.label.startsWith('10-'));
    const post = captures.filter((c) => c.label.startsWith('11-')).at(-1);
    expect(episodeOf(pre!.label)).toBe(episodeOf(post!.label));
    expect(pre?.domTarget?.selector).toBe('a#later');
    expect(post?.domTarget?.selector).toBe('a#later');
  });

  it('captures the resting frame before the click and the response after it', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent({ scrollY: 10 }),
      click(),
      frameEvent({ scrollY: 99 }),
    ]);

    expect(captures[0]?.frame.scrollY).toBe(10);
    expect(captures[1]?.frame.scrollY).toBe(99);
  });

  it('carries DOM target metadata on both captures', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent(),
      click('button.primary'),
      frameEvent(),
    ]);

    expect(captures).toHaveLength(2);
    for (const capture of captures) {
      expect(capture.domTarget?.selector).toBe('button.primary');
    }
  });

  it('fires post-click only once per click', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent(),
      click(),
      frameEvent(),
      frameEvent(),
      frameEvent(),
    ]);

    expect(captures.filter((c) => c.label.startsWith('11-'))).toHaveLength(1);
  });

  it('restarts numbering for a new document', () => {
    const captures = run([
      navigated('loader-a'),
      frameEvent(),
      click(),
      frameEvent(),
      navigated('loader-b'),
      frameEvent(),
      click(),
      frameEvent(),
    ]);

    expect(captures.map((c) => c.label)).toEqual([
      '10-pre-click-01',
      '11-post-click-01',
      '10-pre-click-01',
      '11-post-click-01',
    ]);
  });
});
