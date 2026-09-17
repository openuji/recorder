import type { DomainEvent, MilestoneCapture } from '@uxr/core';
import type { MilestoneRule } from './rule.js';
import { initialEngineState, reduce, type EngineState } from './reduce.js';

/**
 * Stateful wrapper around the pure `reduce`. All the logic lives in the
 * reducer; this only holds the current state and the rule set, so the engine
 * can be exercised in tests without a browser.
 */
export class RulesEngine {
  private state: EngineState = initialEngineState;
  private readonly rules: readonly MilestoneRule[];

  constructor(rules: readonly MilestoneRule[]) {
    assertUniqueRuleIds(rules);
    this.rules = rules;
  }

  public get currentState(): EngineState {
    return this.state;
  }

  public processEvent(event: DomainEvent): readonly MilestoneCapture[] {
    const { state, captures } = reduce(this.state, event, this.rules);
    this.state = state;
    return captures;
  }

  public reset(): void {
    this.state = initialEngineState;
  }
}

/**
 * Rule state is keyed by id, so duplicates would silently share — and corrupt —
 * one slot. Fail loudly at construction instead.
 */
function assertUniqueRuleIds(rules: readonly MilestoneRule[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.id)) duplicates.add(rule.id);
    seen.add(rule.id);
  }

  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate milestone rule id(s): ${[...duplicates].join(', ')}`,
    );
  }
}
