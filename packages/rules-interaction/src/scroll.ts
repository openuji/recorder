import type { CompositorFrame, DocumentState } from '@openuji/core';
import { unchanged, type MilestoneRule } from '@openuji/engine';
import { episodeLabel } from './episode.js';

export type ScrollLifecycleState = Readonly<{
  episodeCount: number;
  isScrolling: boolean;
  startFrame: CompositorFrame | null;
  lastMovingFrame: CompositorFrame | null;
  stationaryCount: number;
  postScrollEmitted: boolean;
}>;

export interface ScrollLifecycleOptions {
  readonly id?: string;
  /**
   * Minimum displacement (px) between two frames to treat motion as an
   * intentional scroll rather than jitter.
   */
  readonly minIntentionalScrollPx?: number;
  /**
   * Consecutive stationary *frames* — not milliseconds — before a scroll is
   * declared settled. At 60fps the default is roughly 80ms. Counting frames is
   * what prevents a kinetic fling from being split into several episodes.
   */
  readonly requiredStationaryFrames?: number;
  /** Per-axis displacement (px) that still counts as ongoing motion. */
  readonly movementEpsilonPx?: number;
}

export const SCROLL_DEFAULTS = {
  minIntentionalScrollPx: 8.0,
  requiredStationaryFrames: 5,
  movementEpsilonPx: 1.0,
} as const;

function settleCapture(
  currentDocument: DocumentState,
  episode: number,
  frame: CompositorFrame,
  startFrame: CompositorFrame | null,
  via: string,
) {
  const deltaY = Math.round(frame.scrollY - (startFrame?.scrollY ?? 0));
  const sign = deltaY >= 0 ? '+' : '';

  return {
    documentId: currentDocument.id,
    loaderId: currentDocument.loaderId,
    url: currentDocument.url,
    label: episodeLabel('04-post-scroll', episode),
    frame,
    detail: `Post-scroll #${episode} settled at (${frame.scrollX}, ${frame.scrollY}) (delta: ${sign}${deltaY}px${via})`,
  };
}

const SETTLED: Omit<ScrollLifecycleState, 'episodeCount'> = {
  isScrolling: false,
  startFrame: null,
  lastMovingFrame: null,
  stationaryCount: 0,
  postScrollEmitted: true,
};

/**
 * Captures the resting visual frames immediately before and after each scroll
 * episode.
 *
 * Unlike the other interaction rules this one is a signal processor: it derives
 * episode boundaries from scroll-offset deltas across the compositor frame
 * stream, with a start threshold and a stationary-frame hysteresis. It also
 * accepts the authoritative DOM `scrollend`, which wins when it arrives because
 * it is the browser's own verdict that motion has stopped.
 */
export function scrollLifecycleRule(
  options: ScrollLifecycleOptions = {},
): MilestoneRule<ScrollLifecycleState> {
  const {
    id = 'scroll-lifecycle',
    minIntentionalScrollPx = SCROLL_DEFAULTS.minIntentionalScrollPx,
    requiredStationaryFrames = SCROLL_DEFAULTS.requiredStationaryFrames,
    movementEpsilonPx = SCROLL_DEFAULTS.movementEpsilonPx,
  } = options;

  return {
    id,
    init: () => ({
      episodeCount: 0,
      isScrolling: false,
      startFrame: null,
      lastMovingFrame: null,
      stationaryCount: 0,
      postScrollEmitted: false,
    }),
    evaluate: (state, event, { currentDocument, lastFrame, currentFrame }) => {
      // 1. Authoritative DOM scrollend from Chromium.
      if (
        event.type === 'interaction' &&
        event.action === 'scrollend' &&
        state.isScrolling &&
        !state.postScrollEmitted
      ) {
        const settledFrame = currentFrame ?? lastFrame ?? state.lastMovingFrame;
        if (!settledFrame) return unchanged(state);

        return {
          nextState: { ...state, ...SETTLED },
          captures: [
            settleCapture(
              currentDocument,
              state.episodeCount,
              settledFrame,
              state.startFrame,
              ' via scrollend',
            ),
          ],
        };
      }

      // 2. Compositor frame deltas.
      if (
        event.type !== 'frame' ||
        !currentFrame ||
        !lastFrame ||
        !currentDocument.firstFrameObserved
      ) {
        return unchanged(state);
      }

      const deltaX = Math.abs(currentFrame.scrollX - lastFrame.scrollX);
      const deltaY = Math.abs(currentFrame.scrollY - lastFrame.scrollY);
      const isMoving =
        deltaX >= movementEpsilonPx || deltaY >= movementEpsilonPx;

      // Motion from rest, past the intentional threshold: a new episode starts,
      // and the frame *before* it is the resting "pre" state.
      if (
        !state.isScrolling &&
        Math.hypot(deltaX, deltaY) >= minIntentionalScrollPx
      ) {
        const episode = state.episodeCount + 1;

        return {
          nextState: {
            episodeCount: episode,
            isScrolling: true,
            startFrame: lastFrame,
            lastMovingFrame: currentFrame,
            stationaryCount: 0,
            postScrollEmitted: false,
          },
          captures: [
            {
              documentId: currentDocument.id,
              loaderId: currentDocument.loaderId,
              url: currentDocument.url,
              label: episodeLabel('03-pre-scroll', episode),
              frame: lastFrame,
              detail: `Pre-scroll #${episode} at (${lastFrame.scrollX}, ${lastFrame.scrollY}) before moving to (${currentFrame.scrollX}, ${currentFrame.scrollY})`,
            },
          ],
        };
      }

      if (!state.isScrolling) {
        return unchanged(state);
      }

      if (isMoving) {
        return {
          nextState: {
            ...state,
            lastMovingFrame: currentFrame,
            stationaryCount: 0,
          },
          captures: [],
        };
      }

      const stationaryCount = state.stationaryCount + 1;

      if (stationaryCount >= requiredStationaryFrames && !state.postScrollEmitted) {
        return {
          nextState: { ...state, ...SETTLED },
          captures: [
            settleCapture(
              currentDocument,
              state.episodeCount,
              currentFrame,
              state.startFrame,
              '',
            ),
          ],
        };
      }

      return { nextState: { ...state, stationaryCount }, captures: [] };
    },
  };
}

/** Scroll episode detection with the tuned defaults. */
export const ScrollLifecycleRule = scrollLifecycleRule();
