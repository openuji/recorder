import type { MilestoneRule } from '@openuji/engine';
import { ClickEpisodeRule } from './click.js';
import { ScrollLifecycleRule } from './scroll.js';

export * from './episode.js';
export * from './click.js';
export * from './scroll.js';

/**
 * User-interaction rules.
 *
 * Unlike the document rules these repeat within a document, numbering each
 * episode, and every capture carries the DOM metadata of what the user touched.
 */
export const defaultInteractionRules: readonly MilestoneRule[] = [
  ScrollLifecycleRule,
  ClickEpisodeRule,
];
