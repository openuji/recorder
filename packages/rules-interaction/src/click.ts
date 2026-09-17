import type { MilestoneCapture, TargetElementMeta } from '@openuji/core';
import { unchanged, type MilestoneRule } from '@openuji/engine';
import { episodeLabel } from './episode.js';

export type ClickEpisodeState = Readonly<{
  /** Clicks seen so far in this document. */
  episodeCount: number;
  /** Target of the click awaiting its follow-up frame, if any. */
  pendingTarget: TargetElementMeta | null;
  /** Episode number that pending target belongs to. */
  pendingEpisode: number;
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
 */
export const ClickEpisodeRule: MilestoneRule<ClickEpisodeState> = {
  id: 'click-episode',
  init: () => ({ episodeCount: 0, pendingTarget: null, pendingEpisode: 0 }),
  evaluate: (state, event, { currentDocument, lastFrame, currentFrame }) => {
    if (event.type === 'interaction' && event.action === 'click') {
      const episode = state.episodeCount + 1;
      const target = event.target;

      const captures: MilestoneCapture[] = lastFrame
        ? [
            {
              documentId: currentDocument.id,
              loaderId: currentDocument.loaderId,
              url: currentDocument.url,
              label: episodeLabel('10-pre-click', episode),
              frame: lastFrame,
              detail: `Pre-click state on <${target.selector}> "${target.textSnippet ?? ''}"`,
              domTarget: target,
            },
          ]
        : [];

      return {
        nextState: {
          episodeCount: episode,
          pendingTarget: target,
          pendingEpisode: episode,
        },
        captures,
      };
    }

    if (event.type === 'frame' && currentFrame && state.pendingTarget) {
      const target = state.pendingTarget;

      return {
        nextState: { ...state, pendingTarget: null },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: episodeLabel('11-post-click', state.pendingEpisode),
            frame: currentFrame,
            detail: `Compositor response after clicking <${target.selector}>`,
            domTarget: target,
          },
        ],
      };
    }

    return unchanged(state);
  },
};
