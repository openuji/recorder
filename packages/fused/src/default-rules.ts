import type { MilestoneRule } from '@openuji/engine';
import { defaultDocumentRules } from '@openuji/rules-document';
import { defaultInteractionRules } from '@openuji/rules-interaction';

/**
 * The standard rule suite: both categories, document rules first.
 *
 * Order matters only within a single event — captures are emitted in rule
 * order — and the two categories never fire on the same event, so this is
 * simply the readable grouping.
 */
export const defaultRules: readonly MilestoneRule[] = [
  ...defaultDocumentRules,
  ...defaultInteractionRules,
];
