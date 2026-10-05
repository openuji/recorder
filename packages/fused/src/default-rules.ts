import type { MilestoneRule } from '@openuji/engine';
import { defaultDocumentRules } from '@openuji/rules-document';
import { defaultInteractionRules } from '@openuji/rules-interaction';

/**
 * The standard rule suite: both categories, document rules first.
 *
 * Order matters only within a single event: captures are emitted in rule
 * order. The categories rarely share an event; when they do — the first frame
 * of a route a click just opened is both that click's post-click and the
 * route's `00-first` — the document rule's capture comes first.
 */
export const defaultRules: readonly MilestoneRule[] = [
  ...defaultDocumentRules,
  ...defaultInteractionRules,
];
