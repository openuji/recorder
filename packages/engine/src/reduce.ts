import type {
  DomainEvent,
  MilestoneCapture,
  ViewEntry,
  ViewState,
} from '@openuji/core';
import type { MilestoneRule, RuleContext } from './rule.js';
import {
  classifyNavigation,
  enterView,
  pathOrHashRoute,
  type NavigatedEvent,
  type RoutePolicy,
} from './view.js';

export type EngineState = Readonly<{
  /** Views entered so far — also the id of the current one. */
  viewCount: number;
  /** Documents loaded so far — also the current view's `documentId`. */
  documentCount: number;
  currentView: ViewState | null;
  /** Per-rule opaque state, keyed by rule id. */
  ruleStates: Readonly<Record<string, unknown>>;
}>;

export interface ReduceResult {
  readonly state: EngineState;
  readonly captures: readonly MilestoneCapture[];
}

export const initialEngineState: EngineState = Object.freeze({
  viewCount: 0,
  documentCount: 0,
  currentView: null,
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

/**
 * The view boundary — the same for a document load and a route change.
 *
 * Every rule first sees `view-exit` against the *departing* view, so
 * final-state captures still see its `lastFrame`. Each rule then initializes
 * for the new view from its state after that exit. The navigation itself is
 * not passed on: rules start from the view, not from the event producing it.
 */
function enter(
  state: EngineState,
  event: NavigatedEvent,
  entry: ViewEntry,
  rules: readonly MilestoneRule[],
): ReduceResult {
  const departing = state.currentView;
  let ruleStates = state.ruleStates;
  let captures: MilestoneCapture[] = [];

  if (departing) {
    const exit = evaluateRules(
      rules,
      ruleStates,
      {
        type: 'view-exit',
        viewId: departing.id,
        url: departing.url,
        nextUrl: event.url,
        nextEntry: entry,
        receivedAtMs: event.receivedAtMs,
      },
      {
        currentView: departing,
        lastFrame: departing.lastFrame,
        currentFrame: null,
      },
    );
    ruleStates = exit.ruleStates;
    captures = exit.captures;
  }

  const view = enterView(departing, event, entry, {
    views: state.viewCount,
    documents: state.documentCount,
  });

  const initialized: Record<string, unknown> = {};
  for (const rule of rules) {
    initialized[rule.id] = rule.init(view, ruleStates[rule.id]);
  }

  return {
    state: {
      viewCount: view.id,
      documentCount: view.documentId,
      currentView: view,
      ruleStates: initialized,
    },
    captures,
  };
}

/**
 * The whole engine, as one pure function.
 *
 * Ordering here is load-bearing:
 *  1. A navigation that starts a new view goes through {@link enter} and stops
 *     there. One that only changes the URL showing updates it in place, so the
 *     rules below already see the new URL.
 *  2. Rules then evaluate against the current view.
 *  3. Only afterwards does `lastFrame` advance to the frame this event carried.
 *     That gap is what lets one rule capture the resting frame *before* an
 *     event while another captures the frame *after* it.
 */
export function reduce(
  state: EngineState,
  event: DomainEvent,
  rules: readonly MilestoneRule[],
  routePolicy: RoutePolicy = pathOrHashRoute,
): ReduceResult {
  let currentView = state.currentView;

  if (event.type === 'navigated') {
    const outcome = classifyNavigation(currentView, event, routePolicy);

    if (outcome?.kind === 'new-view') {
      return enter(state, event, outcome.entry, rules);
    }
    if (outcome?.kind === 'url-update' && currentView) {
      currentView = { ...currentView, url: event.url };
    }
  }

  if (!currentView) {
    return { state, captures: [] };
  }

  const currentFrame = event.type === 'frame' ? event.frame : null;

  const evaluated = evaluateRules(rules, state.ruleStates, event, {
    currentView,
    lastFrame: currentView.lastFrame,
    currentFrame,
  });

  return {
    state: {
      ...state,
      currentView: currentFrame
        ? { ...currentView, firstFrameObserved: true, lastFrame: currentFrame }
        : currentView,
      ruleStates: evaluated.ruleStates,
    },
    captures: evaluated.captures,
  };
}
