import { describe, expect, it } from 'vitest';
import type { DomainEvent, MilestoneCapture } from '@openuji/core';
import {
  RulesEngine,
  initialEngineState,
  reduce,
  unchanged,
  type MilestoneRule,
} from '@openuji/engine';
import { defaultDocumentRules } from '@openuji/rules-document';
import { committed, frameEvent, lifecycle } from './helpers.js';

/** Records every event it is shown, so we can assert on engine dispatch. */
function spyRule(id: string): MilestoneRule<string[]> & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    id,
    seen,
    init: () => {
      const log: string[] = [];
      seen.push(log);
      return log;
    },
    evaluate: (state, event) => {
      state.push(event.type);
      return unchanged(state);
    },
  };
}

function run(
  events: readonly DomainEvent[],
  rules: readonly MilestoneRule[],
): MilestoneCapture[] {
  const engine = new RulesEngine(rules);
  return events.flatMap((event) => [...engine.processEvent(event)]);
}

describe('reduce', () => {
  it('ignores everything until a main-frame document commits', () => {
    const { state, captures } = reduce(
      initialEngineState,
      frameEvent(),
      defaultDocumentRules,
    );

    expect(captures).toEqual([]);
    expect(state.currentDocument).toBeNull();
  });

  it('assigns incrementing document ids across navigations', () => {
    const engine = new RulesEngine(defaultDocumentRules);

    engine.processEvent(committed('loader-a'));
    expect(engine.currentState.currentDocument?.id).toBe(1);

    engine.processEvent(committed('loader-b'));
    expect(engine.currentState.currentDocument?.id).toBe(2);
  });

  it('keeps document identity and rule state across a same-loader redirect', () => {
    const engine = new RulesEngine(defaultDocumentRules);

    engine.processEvent(committed('loader-a', 'https://example.com/one'));
    const first = engine.processEvent(frameEvent());
    expect(first.map((c) => c.label)).toEqual(['00-first']);

    // Same loaderId: a URL update, not a new document.
    engine.processEvent(committed('loader-a', 'https://example.com/two'));
    expect(engine.currentState.currentDocument?.id).toBe(1);
    expect(engine.currentState.currentDocument?.url).toBe(
      'https://example.com/two',
    );

    // first-frame already fired for this document and must not fire again.
    expect(engine.processEvent(frameEvent())).toEqual([]);
  });

  it('resets rule state for each new document', () => {
    const engine = new RulesEngine(defaultDocumentRules);

    engine.processEvent(committed('loader-a'));
    expect(engine.processEvent(frameEvent()).map((c) => c.label)).toEqual([
      '00-first',
    ]);

    engine.processEvent(committed('loader-b'));
    const captures = engine.processEvent(frameEvent());
    expect(captures.map((c) => c.label)).toEqual(['00-first']);
    expect(captures[0]?.documentId).toBe(2);
  });

  it('does not replay the commit event into freshly initialized rules', () => {
    const spy = spyRule('spy');

    run([committed('loader-a'), frameEvent()], [spy]);

    // One init for the document; the commit that created it is not dispatched.
    expect(spy.seen).toHaveLength(1);
    expect(spy.seen[0]).toEqual(['frame']);
  });

  it('delivers document-exit to every rule, against the departing document', () => {
    const spy = spyRule('spy');

    run(
      [committed('loader-a'), frameEvent(), committed('loader-b')],
      [spy],
    );

    expect(spy.seen[0]).toEqual(['frame', 'document-exit']);
    // The second document starts clean.
    expect(spy.seen[1]).toEqual([]);
  });

  it('evaluates document-exit once and returns what it captured', () => {
    let exitEvaluations = 0;

    const onceOnExit: MilestoneRule<{ done: boolean }> = {
      id: 'once-on-exit',
      init: () => ({ done: false }),
      evaluate: (state, event, { currentDocument, lastFrame }) => {
        if (event.type !== 'document-exit' || state.done || !lastFrame) {
          return unchanged(state);
        }
        exitEvaluations += 1;
        return {
          nextState: { done: true },
          captures: [
            {
              documentId: currentDocument.id,
              loaderId: currentDocument.loaderId,
              url: currentDocument.url,
              label: 'exit',
              frame: lastFrame,
              detail: 'exit capture',
            },
          ],
        };
      },
    };

    const engine = new RulesEngine([onceOnExit]);
    engine.processEvent(committed('loader-a'));
    engine.processEvent(frameEvent());

    const captures = engine.processEvent(committed('loader-b'));

    expect(exitEvaluations).toBe(1);
    // Captures from the departing document are returned by the commit that
    // replaced it, and they carry the departing document's identity.
    expect(captures.map((c) => c.label)).toEqual(['exit']);
    expect(captures[0]?.documentId).toBe(1);
    expect(captures[0]?.loaderId).toBe('loader-a');

    // The incoming document starts from freshly initialized state, so the same
    // rule is armed again rather than staying latched from the previous one.
    expect(engine.currentState.ruleStates['once-on-exit']).toEqual({
      done: false,
    });
  });

  it('rejects duplicate rule ids', () => {
    expect(() => new RulesEngine([spyRule('dup'), spyRule('dup')])).toThrow(
      /Duplicate milestone rule id/,
    );
  });
});

describe('document lifecycle rules', () => {
  it('captures the frame after a milestone, not the milestone itself', () => {
    const captures = run(
      [
        committed('loader-a'),
        frameEvent(),
        lifecycle('DOMContentLoaded', 'loader-a'),
        frameEvent(),
        lifecycle('networkAlmostIdle', 'loader-a'),
        frameEvent(),
      ],
      defaultDocumentRules,
    );

    expect(captures.map((c) => c.label)).toEqual([
      '00-first',
      '01-domcontentloaded',
      '02-settled',
    ]);
  });

  it('ignores lifecycle events belonging to another loader', () => {
    const captures = run(
      [
        committed('loader-a'),
        frameEvent(),
        lifecycle('DOMContentLoaded', 'some-subframe-loader'),
        frameEvent(),
      ],
      defaultDocumentRules,
    );

    expect(captures.map((c) => c.label)).toEqual(['00-first']);
  });

  it('captures the departing frame exactly once on navigation', () => {
    const captures = run(
      [
        committed('loader-a'),
        frameEvent({ scrollY: 500 }),
        committed('loader-b'),
        frameEvent(),
      ],
      defaultDocumentRules,
    );

    const farewell = captures.filter(
      (c) => c.label === '99-before-navigation',
    );
    expect(farewell).toHaveLength(1);
    expect(farewell[0]?.documentId).toBe(1);
    expect(farewell[0]?.frame.scrollY).toBe(500);
    expect(farewell[0]?.detail).toContain('next URL is');
  });

  it('captures the final resting state on stop', () => {
    const captures = run(
      [committed('loader-a'), frameEvent({ scrollY: 120 }), { type: 'stop' }],
      defaultDocumentRules,
    );

    const last = captures.at(-1);
    expect(last?.label).toBe('99-before-navigation');
    expect(last?.frame.scrollY).toBe(120);
    expect(last?.detail).toContain('Session ending');
  });
});
