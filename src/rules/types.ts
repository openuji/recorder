import type {
  CompositorFrame,
  DocumentState,
  DomainEvent,
  MilestoneCapture,
} from '../types.js';

export interface RuleContext {
  readonly currentDocument: DocumentState;
  readonly lastFrame: CompositorFrame | null;
  readonly currentFrame: CompositorFrame | null;
}

export interface MilestoneRule<TState = any> {
  readonly id: string;

  /** Initialize or reset rule state when a new document commits */
  init(doc: DocumentState): TState;

  /** Pure evaluation of a domain event against current state */
  evaluate(
    state: TState,
    event: DomainEvent,
    ctx: RuleContext,
  ): {
    nextState: TState;
    captures: readonly MilestoneCapture[];
  };
}
