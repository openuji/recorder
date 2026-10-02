import { unchanged, type MilestoneRule } from '@openuji/engine';

export type LifecycleMilestoneState = Readonly<{
  /** A matching lifecycle notification arrived; capture the next frame. */
  armed: boolean;
  /** Already captured once for this document. */
  fired: boolean;
}>;

export interface LifecycleMilestoneOptions {
  /** Unique rule id. */
  readonly id: string;
  /** CDP `Page.lifecycleEvent` name to arm on, e.g. `'DOMContentLoaded'`. */
  readonly milestone: string;
  /** Capture label, which also orders the output filenames. */
  readonly label: string;
  /** Human-readable explanation stored with the capture. */
  readonly detail: string;
}

/**
 * Builds a one-shot "arm on a lifecycle notification, capture the next
 * compositor frame" rule.
 *
 * A lifecycle notification tells us the milestone was reached, but not what the
 * user can see — the pixels for it land on a later frame. So the rule arms on
 * the notification and captures the first frame after it.
 *
 * One rule per milestone: enabling or disabling a milestone is an entry in the
 * rule array rather than another pair of flags inside a shared rule.
 */
export function lifecycleMilestoneRule({
  id,
  milestone,
  label,
  detail,
}: LifecycleMilestoneOptions): MilestoneRule<LifecycleMilestoneState> {
  return {
    id,
    init: () => ({ armed: false, fired: false }),
    evaluate: (state, event, { currentDocument, currentFrame }) => {
      if (event.type === 'milestone') {
        if (
          event.name !== milestone ||
          event.loaderId !== currentDocument.loaderId ||
          state.fired
        ) {
          return unchanged(state);
        }
        return { nextState: { ...state, armed: true }, captures: [] };
      }

      if (event.type === 'frame' && currentFrame && state.armed && !state.fired) {
        return {
          nextState: { armed: false, fired: true },
          captures: [
            {
              documentId: currentDocument.id,
              loaderId: currentDocument.loaderId,
              url: currentDocument.url,
              label,
              frame: currentFrame,
              detail,
            },
          ],
        };
      }

      return unchanged(state);
    },
  };
}

/** Compositor frame following `DOMContentLoaded`. */
export const DomContentLoadedRule = lifecycleMilestoneRule({
  id: 'lifecycle-domcontentloaded',
  milestone: 'DOMContentLoaded',
  label: '01-domcontentloaded',
  detail: 'Compositor frame following DOMContentLoaded',
});

/** Compositor frame once the network has gone quiet — the "settled" view. */
export const NetworkAlmostIdleRule = lifecycleMilestoneRule({
  id: 'lifecycle-network-almost-idle',
  milestone: 'networkAlmostIdle',
  label: '02-settled',
  detail: 'Compositor frame following networkAlmostIdle',
});

/**
 * Compositor frame following the `load` event. Not enabled by default —
 * `networkAlmostIdle` proved the better settle signal. Note it shares the `02-`
 * label prefix with {@link NetworkAlmostIdleRule}; pass a custom `label` to
 * {@link lifecycleMilestoneRule} if you want both at once.
 */
export const LoadRule = lifecycleMilestoneRule({
  id: 'lifecycle-load',
  milestone: 'load',
  label: '02-load',
  detail: 'Compositor frame following page load',
});
