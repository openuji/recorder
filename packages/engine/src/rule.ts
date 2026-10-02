import type {
  CompositorFrame,
  DocumentState,
  DomainEvent,
  MilestoneCapture,
} from '@openuji/core';

export interface RuleContext {
  readonly currentDocument: DocumentState;
  /**
   * The last frame the engine has finished processing — i.e. the resting state
   * *before* the current event. Rules capturing a "pre-" milestone use this.
   */
  readonly lastFrame: CompositorFrame | null;
  /** The frame carried by this event, or null for non-frame events. */
  readonly currentFrame: CompositorFrame | null;
}

export interface RuleResult<TState> {
  readonly nextState: TState;
  readonly captures: readonly MilestoneCapture[];
}

/**
 * A pluggable milestone detector.
 *
 * `TState` is opaque to the engine: it is stored keyed by `id` and handed back
 * to the same rule untouched, so no rule can observe or corrupt another's
 * state. That is why the default is `unknown` rather than `any`.
 */
export interface MilestoneRule<TState = unknown> {
  readonly id: string;

  /** Build fresh state for a document the main frame just navigated to. */
  init(doc: DocumentState): TState;

  /** Pure evaluation of a domain event against current state. */
  evaluate(
    state: TState,
    event: DomainEvent,
    ctx: RuleContext,
  ): RuleResult<TState>;
}

/** No state change, nothing captured — the common case in every rule. */
export function unchanged<TState>(state: TState): RuleResult<TState> {
  return { nextState: state, captures: EMPTY_CAPTURES };
}

const EMPTY_CAPTURES: readonly MilestoneCapture[] = Object.freeze([]);
