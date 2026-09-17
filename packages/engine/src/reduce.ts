import type {
  DocumentState,
  DomainEvent,
  MilestoneCapture,
} from '@uxr/core';
import type { MilestoneRule, RuleContext } from './rule.js';

export type EngineState = Readonly<{
  mainFrameId: string | null;
  nextDocumentId: number;
  currentDocument: DocumentState | null;
  /** Per-rule opaque state, keyed by rule id. */
  ruleStates: Readonly<Record<string, unknown>>;
}>;

export interface ReduceResult {
  readonly state: EngineState;
  readonly captures: readonly MilestoneCapture[];
}

export const initialEngineState: EngineState = Object.freeze({
  mainFrameId: null,
  nextDocumentId: 0,
  currentDocument: null,
  ruleStates: Object.freeze({}),
});

/** Run every rule once against one event, threading each rule's own state. */
function evaluateRules(
  rules: readonly MilestoneRule[],
  ruleStates: Readonly<Record<string, unknown>>,
  event: DomainEvent,
  ctx: RuleContext,
): { ruleStates: Record<string, unknown>; captures: MilestoneCapture[] } {
  const nextStates: Record<string, unknown> = { ...ruleStates };
  const captures: MilestoneCapture[] = [];

  for (const rule of rules) {
    const result = rule.evaluate(nextStates[rule.id], event, ctx);
    nextStates[rule.id] = result.nextState;
    if (result.captures.length > 0) {
      captures.push(...result.captures);
    }
  }

  return { ruleStates: nextStates, captures };
}

function initRuleStates(
  rules: readonly MilestoneRule[],
  doc: DocumentState,
): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const rule of rules) {
    states[rule.id] = rule.init(doc);
  }
  return states;
}

/**
 * The whole engine, as one pure function.
 *
 * Ordering here is load-bearing:
 *  1. A new main-frame document first gives every rule a `document-exit` event
 *     against the *departing* document, so final-state captures still see that
 *     document's `lastFrame`.
 *  2. Rules then evaluate against the current document.
 *  3. Only afterwards does `lastFrame` advance to the frame this event carried.
 *     That gap is what lets one rule capture the resting frame *before* an
 *     event while another captures the frame *after* it.
 */
export function reduce(
  state: EngineState,
  event: DomainEvent,
  rules: readonly MilestoneRule[],
): ReduceResult {
  let working = state;
  const exitCaptures: MilestoneCapture[] = [];

  if (event.type === 'committed' && event.isMainFrame) {
    const current = working.currentDocument;

    if (current && current.loaderId === event.loaderId) {
      // Redirection or URL update under the same loader: the document lives on,
      // so rule state is preserved and evaluation continues below.
      working = {
        ...working,
        currentDocument: { ...current, url: event.url },
      };
    } else {
      if (current) {
        const exitEvent: DomainEvent = {
          type: 'document-exit',
          documentId: current.id,
          loaderId: current.loaderId,
          url: current.url,
          nextLoaderId: event.loaderId,
          nextUrl: event.url,
          timestamp: event.timestamp,
        };

        const exit = evaluateRules(rules, working.ruleStates, exitEvent, {
          currentDocument: current,
          lastFrame: current.lastFrame,
          currentFrame: null,
        });

        working = { ...working, ruleStates: exit.ruleStates };
        exitCaptures.push(...exit.captures);
      }

      const id = working.nextDocumentId + 1;
      const newDocument: DocumentState = {
        id,
        loaderId: event.loaderId,
        url: event.url,
        firstFrameObserved: false,
        lastFrame: null,
      };

      // The commit that created this document is deliberately not replayed into
      // the freshly initialized rules; they start from the document, not from
      // the event that produced it.
      return {
        state: {
          mainFrameId: event.frameId,
          nextDocumentId: id,
          currentDocument: newDocument,
          ruleStates: initRuleStates(rules, newDocument),
        },
        captures: exitCaptures,
      };
    }
  }

  const currentDocument = working.currentDocument;
  if (!currentDocument) {
    return { state: working, captures: exitCaptures };
  }

  const currentFrame = event.type === 'frame' ? event.frame : null;

  const evaluated = evaluateRules(rules, working.ruleStates, event, {
    currentDocument,
    lastFrame: currentDocument.lastFrame,
    currentFrame,
  });

  return {
    state: {
      ...working,
      currentDocument: currentFrame
        ? {
            ...currentDocument,
            firstFrameObserved: true,
            lastFrame: currentFrame,
          }
        : currentDocument,
      ruleStates: evaluated.ruleStates,
    },
    captures: [...exitCaptures, ...evaluated.captures],
  };
}
