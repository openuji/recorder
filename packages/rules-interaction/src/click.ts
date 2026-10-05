import type {
  MilestoneCapture,
  TargetElementMeta,
  ViewState,
} from '@openuji/core';
import { captureFor, unchanged, type MilestoneRule } from '@openuji/engine';
import { episodeLabel, InteractionLabel } from './episode.js';

/** A click whose follow-up frame has not arrived yet. */
export type PendingClick = Readonly<{
  target: TargetElementMeta;
  episode: number;
  /** The view the click happened in — its post-click is filed there. */
  view: ViewState;
}>;

export type ClickEpisodeState = Readonly<{
  /** Clicks seen so far in this view. */
  episodeCount: number;
  pending: PendingClick | null;
}>;

/**
 * Captures the visual state immediately before and immediately after each
 * click, both tagged with the clicked element's DOM metadata.
 *
 * Pre and post are one rule with one counter on purpose. They were previously
 * two rules each keeping their own count, with different increment conditions —
 * a single click before the first compositor frame arrived desynchronized them
 * permanently, pairing `10-pre-click-01` with `11-post-click-02`.
 *
 * The counter therefore advances on every click. If no frame has been seen yet
 * there is nothing to show as the "before" state, so that episode yields only a
 * post-click capture — but its number still refers to the same click.
 *
 * Numbering restarts with every view, but a click still waiting for its frame
 * is carried into the next one: a click that navigates — an SPA link above all,
 * whose route changes before anything is painted — still gets its post-click,
 * filed with its pre-click under the view it was clicked in.
 */
export const ClickEpisodeRule: MilestoneRule<ClickEpisodeState> = {
  id: 'click-episode',
  init: (_view, previous) => ({
    episodeCount: 0,
    pending: previous?.pending ?? null,
  }),
  evaluate: (state, event, { currentView, lastFrame, currentFrame }) => {
    if (event.type === 'interaction' && event.action === 'click') {
      const episode = state.episodeCount + 1;
      const target = event.target;

      const captures: MilestoneCapture[] = lastFrame
        ? [
            captureFor(currentView, {
              label: episodeLabel(InteractionLabel.preClick, episode),
              frame: lastFrame,
              detail: `Pre-click state on <${target.selector}> "${target.textSnippet ?? ''}"`,
              domTarget: target,
            }),
          ]
        : [];

      return {
        nextState: {
          episodeCount: episode,
          pending: { target, episode, view: currentView },
        },
        captures,
      };
    }

    if (event.type === 'frame' && currentFrame && state.pending) {
      const { target, episode, view } = state.pending;
      const sameView = view.id === currentView.id;

      return {
        nextState: { ...state, pending: null },
        captures: [
          // Within its view the click is filed with the URL showing now — the
          // click may itself have updated it.
          captureFor(sameView ? currentView : view, {
            label: episodeLabel(InteractionLabel.postClick, episode),
            frame: currentFrame,
            detail: sameView
              ? `Compositor response after clicking <${target.selector}>`
              : `Compositor response after clicking <${target.selector}>, now showing ${currentView.url}`,
            domTarget: target,
          }),
        ],
      };
    }

    return unchanged(state);
  },
};
