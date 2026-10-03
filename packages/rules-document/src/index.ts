import type { MilestoneRule } from '@openuji/engine';
import { FirstFrameRule } from './first-frame.js';
import {
  DomContentLoadedRule,
  NetworkAlmostIdleRule,
} from './lifecycle-milestone.js';
import { BeforeNavigationRule } from './before-navigation.js';

export * from './labels.js';
export * from './first-frame.js';
export * from './lifecycle-milestone.js';
export * from './before-navigation.js';

/**
 * Document-lifecycle rules, in label order.
 *
 * Every rule here is one-shot per document and scoped to its `loaderId`: the
 * engine re-initializes all of them when the main frame navigates to a new
 * document.
 */
export const defaultDocumentRules: readonly MilestoneRule[] = [
  FirstFrameRule,
  DomContentLoadedRule,
  NetworkAlmostIdleRule,
  BeforeNavigationRule,
];
