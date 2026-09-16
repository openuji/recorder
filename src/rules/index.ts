import type { MilestoneRule } from './types.js';
import { FirstFrameRule } from './first-frame.js';
import { LifecycleMilestonesRule } from './lifecycle-milestones.js';
import { ScrollLifecycleRule } from './scroll.js';
import { PreClickRule, PostClickRule } from './click.js';
import { BeforeNavigationRule } from './navigation.js';

export * from './types.js';
export * from './first-frame.js';
export * from './lifecycle-milestones.js';
export * from './scroll.js';
export * from './click.js';
export * from './navigation.js';

/** Standard suite of milestone capture rules */
export const defaultRules: readonly MilestoneRule[] = [
  FirstFrameRule,
  LifecycleMilestonesRule,
  ScrollLifecycleRule,
  PreClickRule,
  PostClickRule,
  BeforeNavigationRule,
];
