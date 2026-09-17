import type { MilestoneRule } from '@uxr/engine';
import { defaultDocumentRules } from '@uxr/rules-document';
import { defaultInteractionRules } from '@uxr/rules-interaction';

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
