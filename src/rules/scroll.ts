import type { MilestoneRule } from './types.js';
import type { CompositorFrame } from '../types.js';

export type ScrollRuleState = Readonly<{
  episodeCount: number;
  isScrolling: boolean;
  startFrame: CompositorFrame | null;
  lastMovingFrame: CompositorFrame | null;
  stationaryCount: number;
  postScrollEmitted: boolean;
}>;

// Minimum displacement (in px) required to consider motion an intentional user scroll
const MIN_INTENTIONAL_SCROLL_PX = 8.0;

// Number of consecutive stationary frames (~80ms at 60fps) required to declare scrolling settled
const REQUIRED_STATIONARY_FRAMES = 5;

/** Rule: Captures resting visual frames immediately before and after EACH scroll episode */
export const ScrollLifecycleRule: MilestoneRule<ScrollRuleState> = {
  id: 'scroll-lifecycle',
  init: () => ({
    episodeCount: 0,
    isScrolling: false,
    startFrame: null,
    lastMovingFrame: null,
    stationaryCount: 0,
    postScrollEmitted: false,
  }),
  evaluate: (state, event, { currentDocument, lastFrame, currentFrame }) => {
    // 1. Authoritative DOM scrollend event from Chromium engine
    if (
      event.type === 'interaction' &&
      event.action === 'scrollend' &&
      state.isScrolling &&
      !state.postScrollEmitted
    ) {
      const settledFrame = currentFrame ?? lastFrame ?? state.lastMovingFrame;
      if (!settledFrame) return { nextState: state, captures: [] };

      const episode = state.episodeCount;
      const startY = state.startFrame?.scrollY ?? 0;
      const deltaY = Math.round(settledFrame.scrollY - startY);

      return {
        nextState: {
          ...state,
          isScrolling: false,
          postScrollEmitted: true,
          startFrame: null,
          lastMovingFrame: null,
          stationaryCount: 0,
        },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: `04-post-scroll-${String(episode).padStart(2, '0')}`,
            frame: settledFrame,
            detail: `Post-scroll #${episode} settled at (${settledFrame.scrollX}, ${settledFrame.scrollY}) (delta: ${deltaY >= 0 ? '+' : ''}${deltaY}px via scrollend)`,
          },
        ],
      };
    }

    // 2. Compositor screencast frame stream
    if (
      event.type === 'frame' &&
      currentFrame &&
      lastFrame &&
      currentDocument.firstFrameObserved
    ) {
      const deltaX = Math.abs(currentFrame.scrollX - lastFrame.scrollX);
      const deltaY = Math.abs(currentFrame.scrollY - lastFrame.scrollY);
      const totalDelta = Math.hypot(deltaX, deltaY);
      const hasSignificantMovement = deltaX >= 1.0 || deltaY >= 1.0;

      // Motion detected from rest: require intentional threshold to prevent 1px jitter/noise
      if (!state.isScrolling && totalDelta >= MIN_INTENTIONAL_SCROLL_PX) {
        const nextEpisode = state.episodeCount + 1;
        return {
          nextState: {
            episodeCount: nextEpisode,
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
              label: `03-pre-scroll-${String(nextEpisode).padStart(2, '0')}`,
              frame: lastFrame, // Resting frame immediately before scroll motion started
              detail: `Pre-scroll #${nextEpisode} at (${lastFrame.scrollX}, ${lastFrame.scrollY}) before moving to (${currentFrame.scrollX}, ${currentFrame.scrollY})`,
            },
          ],
        };
      }

      // Motion is active and ongoing
      if (state.isScrolling && hasSignificantMovement) {
        return {
          nextState: {
            ...state,
            lastMovingFrame: currentFrame,
            stationaryCount: 0,
          },
          captures: [],
        };
      }

      // Frame arrived with no significant movement while in scrolling state
      if (state.isScrolling && !hasSignificantMovement) {
        const nextStationary = state.stationaryCount + 1;

        // Settle only after consecutive stationary frames (prevents splitting kinetic flings)
        if (nextStationary >= REQUIRED_STATIONARY_FRAMES && !state.postScrollEmitted) {
          const episode = state.episodeCount;
          const startY = state.startFrame?.scrollY ?? 0;
          const deltaY = Math.round(currentFrame.scrollY - startY);

          return {
            nextState: {
              ...state,
              isScrolling: false,
              postScrollEmitted: true,
              startFrame: null,
              lastMovingFrame: null,
              stationaryCount: 0,
            },
            captures: [
              {
                documentId: currentDocument.id,
                loaderId: currentDocument.loaderId,
                url: currentDocument.url,
                label: `04-post-scroll-${String(episode).padStart(2, '0')}`,
                frame: currentFrame,
                detail: `Post-scroll #${episode} settled at (${currentFrame.scrollX}, ${currentFrame.scrollY}) (delta: ${deltaY >= 0 ? '+' : ''}${deltaY}px)`,
              },
            ],
          };
        }

        return {
          nextState: {
            ...state,
            stationaryCount: nextStationary,
          },
          captures: [],
        };
      }
    }

    return { nextState: state, captures: [] };
  },
};
