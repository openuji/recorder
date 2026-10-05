import type {
  CompositorFrame,
  MilestoneCapture,
  ScrollEpisode,
  ScrollInputKind,
  ScrollPosition,
  TargetElementMeta,
  ViewState,
} from '@openuji/core';
import {
  captureFor,
  unchanged,
  type MilestoneRule,
  type RuleContext,
  type RuleResult,
} from '@openuji/engine';
import { episodeLabel, InteractionLabel } from './episode.js';
import {
  at,
  frameMotion,
  isViewport,
  sameScroller,
  scrollerName,
  signed,
  viewportScroller,
} from './scroll-motion.js';

/** A scroll in progress. */
export type OpenScrollEpisode = Readonly<{
  scroller: TargetElementMeta;
  /**
   * `pending` until scroll input shows a person is behind it; an episode that
   * settles still pending was the page scrolling itself.
   */
  origin: 'user' | 'pending';
  /** Its user episode number, once `origin` is `user`. */
  number: number;
  input?: ScrollInputKind;
  /** The resting frame before it moved. */
  startFrame: CompositorFrame;
  from?: ScrollPosition;
  /** The probe reported this scroller, so its `scrollend` settles the episode. */
  probed: boolean;
  /** For the page: the frame-delta hysteresis. */
  lastMovingFrame: CompositorFrame;
  stationaryCount: number;
}>;

export type ScrollLifecycleState = Readonly<{
  userEpisodes: number;
  autoEpisodes: number;
  /** Frames during which the last scroll input still counts as a scroll's cause. */
  inputFramesLeft: number;
  input: ScrollInputKind | null;
  /** The resting frame when that input arrived. */
  inputFrame: CompositorFrame | null;
  episode: OpenScrollEpisode | null;
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
  /**
   * For how many frames after scroll input a scroll that starts counts as the
   * person's. Frames, like everything else here: arrival order, not time.
   */
  readonly inputFreshFrames?: number;
}

export const SCROLL_DEFAULTS = {
  minIntentionalScrollPx: 8.0,
  requiredStationaryFrames: 5,
  movementEpsilonPx: 1.0,
  inputFreshFrames: 30,
} as const;

const INITIAL: ScrollLifecycleState = {
  userEpisodes: 0,
  autoEpisodes: 0,
  inputFramesLeft: 0,
  input: null,
  inputFrame: null,
  episode: null,
};

type Result = RuleResult<ScrollLifecycleState>;
type Origin = ScrollEpisode['origin'];

function episodeData(
  episode: OpenScrollEpisode,
  origin: Origin,
  to?: ScrollPosition,
): ScrollEpisode {
  return {
    scroller: episode.scroller,
    origin,
    ...(origin === 'user' && episode.input ? { input: episode.input } : {}),
    ...(episode.from ? { from: episode.from } : {}),
    ...(to ? { to } : {}),
  };
}

/** The page's offsets from the frames; an element's only from the probe. */
function startOf(episode: OpenScrollEpisode): Pick<ScrollPosition, 'x' | 'y'> | undefined {
  if (episode.from) return episode.from;
  if (!isViewport(episode.scroller)) return undefined;
  return { x: episode.startFrame.scrollX, y: episode.startFrame.scrollY };
}

function preCapture(
  view: ViewState,
  episode: OpenScrollEpisode,
  origin: Origin,
  number: number,
): MilestoneCapture {
  const start = startOf(episode);
  const name = origin === 'user' ? 'Pre-scroll' : 'Pre-auto-scroll';
  // Screencast frames carry the page's offset only, so for an element the
  // frame is the one before its scroll was reported, not one known at rest.
  const approximate = isViewport(episode.scroller) ? '' : ' (resting frame approximate)';

  return captureFor(view, {
    label: episodeLabel(
      origin === 'user' ? InteractionLabel.preScroll : InteractionLabel.preAutoScroll,
      number,
    ),
    frame: episode.startFrame,
    detail: `${name} #${number} of ${scrollerName(episode.scroller)}${start ? ` at ${at(start)}` : ''}${approximate}`,
    domTarget: episode.scroller,
    scrollEpisode: episodeData(episode, origin),
  });
}

function postCapture(
  view: ViewState,
  episode: OpenScrollEpisode,
  origin: Origin,
  number: number,
  frame: CompositorFrame,
  to: ScrollPosition | undefined,
  via: string,
): MilestoneCapture {
  const page = isViewport(episode.scroller);
  const start = startOf(episode);
  const end = to ?? (page ? { x: frame.scrollX, y: frame.scrollY } : undefined);
  const name = origin === 'user' ? 'Post-scroll' : 'Post-auto-scroll';
  const delta = start && end ? `delta: ${signed(end.y - start.y)}` : '';
  const how = [delta, via].filter(Boolean).join(' ');

  return captureFor(view, {
    label: episodeLabel(
      origin === 'user' ? InteractionLabel.postScroll : InteractionLabel.postAutoScroll,
      number,
    ),
    frame,
    detail: `${name} #${number} of ${scrollerName(episode.scroller)} settled${end ? ` at ${at(end)}` : ''}${how ? ` (${how})` : ''}`,
    domTarget: episode.scroller,
    scrollEpisode: episodeData(episode, origin, to),
  });
}

/**
 * Captures the resting visual frames immediately before and after each scroll
 * episode — of the page or of any element with its own scrollbar — and tells
 * a person's scroll (`03`/`04`) from the page scrolling itself (`05`/`06`: a
 * router resetting the scroll, a scroll to an error, scroll anchoring).
 *
 * One episode concept, two signals behind it:
 *  - **The page's frame deltas.** Screencast frames carry the page's scroll
 *    offset, so its resting frames are exact: motion past a start threshold
 *    opens an episode, and a stationary-frame hysteresis settles it.
 *  - **The probe's `scrollstart`/`scrollend`.** They cover every scroller, also
 *    where screencast offsets read 0, and carry exact positions. A scroller's
 *    `scrollend` is the browser's own verdict that it stopped, so it settles an
 *    episode the probe reported.
 *
 * Who scrolled is decided by scroll input (`scrollinput`: wheel, touch, keys,
 * scrollbar). An episode that opens with fresh input is the user's, and its
 * pre-scroll is captured right away. One without is pending — Chrome scrolls
 * on the compositor thread, so motion can be painted before the input reaches
 * the page — and is promoted the moment input arrives. Still pending when it
 * settles, it was the page's own. Input explains one episode at most; a
 * gesture that goes on keeps reporting, and so keeps its scrolls the user's.
 *
 * Nothing is left half-open: a navigation or the end of the session settles
 * the open episode on the last frame.
 */
export function scrollLifecycleRule(
  options: ScrollLifecycleOptions = {},
): MilestoneRule<ScrollLifecycleState> {
  const {
    id = 'scroll-lifecycle',
    minIntentionalScrollPx = SCROLL_DEFAULTS.minIntentionalScrollPx,
    requiredStationaryFrames = SCROLL_DEFAULTS.requiredStationaryFrames,
    movementEpsilonPx = SCROLL_DEFAULTS.movementEpsilonPx,
    inputFreshFrames = SCROLL_DEFAULTS.inputFreshFrames,
  } = options;

  const open = (
    state: ScrollLifecycleState,
    view: ViewState,
    fresh: boolean,
    episode: Omit<OpenScrollEpisode, 'origin' | 'number' | 'input' | 'stationaryCount'>,
  ): Result => {
    if (!fresh) {
      return {
        nextState: {
          ...state,
          episode: { ...episode, origin: 'pending', number: 0, stationaryCount: 0 },
        },
        captures: [],
      };
    }

    const number = state.userEpisodes + 1;
    const opened: OpenScrollEpisode = {
      ...episode,
      origin: 'user',
      number,
      ...(state.input ? { input: state.input } : {}),
      stationaryCount: 0,
    };
    return {
      // The input is spent: it explains this episode, not the next one.
      nextState: { ...state, userEpisodes: number, inputFramesLeft: 0, episode: opened },
      captures: [preCapture(view, opened, 'user', number)],
    };
  };

  const settle = (
    state: ScrollLifecycleState,
    { currentView }: RuleContext,
    frame: CompositorFrame,
    to: ScrollPosition | undefined,
    via: string,
  ): Result => {
    const episode = state.episode;
    if (!episode) return unchanged(state);

    if (episode.origin === 'user') {
      return {
        nextState: { ...state, episode: null },
        captures: [
          postCapture(currentView, episode, 'user', episode.number, frame, to, via),
        ],
      };
    }

    const number = state.autoEpisodes + 1;
    return {
      nextState: { ...state, autoEpisodes: number, episode: null },
      captures: [
        preCapture(currentView, episode, 'auto', number),
        postCapture(currentView, episode, 'auto', number, frame, to, via),
      ],
    };
  };

  const onInput = (
    state: ScrollLifecycleState,
    input: ScrollInputKind | undefined,
    { currentView, lastFrame }: RuleContext,
  ): Result => {
    const next: ScrollLifecycleState = {
      ...state,
      inputFramesLeft: inputFreshFrames,
      input: input ?? null,
      inputFrame: lastFrame,
    };

    const episode = state.episode;
    if (episode?.origin !== 'pending') return { nextState: next, captures: [] };

    const number = state.userEpisodes + 1;
    const promoted: OpenScrollEpisode = {
      ...episode,
      origin: 'user',
      number,
      ...(input ? { input } : {}),
    };
    return {
      nextState: { ...next, userEpisodes: number, inputFramesLeft: 0, episode: promoted },
      captures: [preCapture(currentView, promoted, 'user', number)],
    };
  };

  const onScrollStart = (
    state: ScrollLifecycleState,
    scroller: TargetElementMeta,
    from: ScrollPosition | undefined,
    ctx: RuleContext,
  ): Result => {
    const episode = state.episode;

    // The probe catching up with an episode the page's frames already opened.
    if (episode && sameScroller(episode.scroller, scroller)) {
      return {
        nextState: {
          ...state,
          episode: {
            ...episode,
            scroller,
            probed: true,
            ...(episode.from ? {} : from ? { from } : {}),
          },
        },
        captures: [],
      };
    }

    // Another scroller took over: whatever scrolled before has stopped.
    const before = episode
      ? settle(state, ctx, ctx.lastFrame ?? episode.lastMovingFrame, undefined, 'another scroller took over')
      : { nextState: state, captures: [] };

    const fresh = state.inputFramesLeft > 0;
    const startFrame = (fresh ? state.inputFrame : null) ?? ctx.lastFrame;
    if (!startFrame) return before;

    const opened = open(before.nextState, ctx.currentView, fresh, {
      scroller,
      startFrame,
      ...(from ? { from } : {}),
      probed: true,
      lastMovingFrame: startFrame,
    });
    return {
      nextState: opened.nextState,
      captures: [...before.captures, ...opened.captures],
    };
  };

  const onScrollEnd = (
    state: ScrollLifecycleState,
    scroller: TargetElementMeta,
    to: ScrollPosition | undefined,
    ctx: RuleContext,
  ): Result => {
    const episode = state.episode;
    if (!episode || !sameScroller(episode.scroller, scroller)) return unchanged(state);

    const frame = ctx.currentFrame ?? ctx.lastFrame ?? episode.lastMovingFrame;
    return settle(state, ctx, frame, to, 'via scrollend');
  };

  const onFrame = (state: ScrollLifecycleState, ctx: RuleContext): Result => {
    const { currentView, lastFrame, currentFrame } = ctx;
    const fresh = state.inputFramesLeft > 0;
    const aged: ScrollLifecycleState = {
      ...state,
      inputFramesLeft: Math.max(0, state.inputFramesLeft - 1),
    };

    if (!currentFrame || !lastFrame || !currentView.firstFrameObserved) {
      return { nextState: aged, captures: [] };
    }

    const motion = frameMotion(lastFrame, currentFrame, movementEpsilonPx);
    const episode = state.episode;

    // Motion from rest, past the intentional threshold: the page's own
    // scroller starts an episode, and the frame *before* it is the resting one.
    if (!episode) {
      if (motion.distance < minIntentionalScrollPx) {
        return { nextState: aged, captures: [] };
      }
      return open(aged, currentView, fresh, {
        scroller: viewportScroller(currentFrame),
        startFrame: lastFrame,
        probed: false,
        lastMovingFrame: currentFrame,
      });
    }

    // An element's motion is invisible in the frames; its scrollend settles it.
    if (!isViewport(episode.scroller)) return { nextState: aged, captures: [] };

    if (motion.moving) {
      return {
        nextState: {
          ...aged,
          episode: { ...episode, lastMovingFrame: currentFrame, stationaryCount: 0 },
        },
        captures: [],
      };
    }

    const stationaryCount = episode.stationaryCount + 1;
    if (!episode.probed && stationaryCount >= requiredStationaryFrames) {
      return settle(aged, ctx, currentFrame, undefined, '');
    }
    return {
      nextState: { ...aged, episode: { ...episode, stationaryCount } },
      captures: [],
    };
  };

  return {
    id,
    // An open episode was settled on `view-exit`; numbering starts over.
    init: () => INITIAL,
    evaluate: (state, event, ctx) => {
      switch (event.type) {
        case 'interaction':
          if (event.action === 'scrollinput') return onInput(state, event.input, ctx);
          if (event.action === 'scrollstart') {
            return onScrollStart(state, event.target, event.scroll, ctx);
          }
          if (event.action === 'scrollend') {
            return onScrollEnd(state, event.target, event.scroll, ctx);
          }
          return unchanged(state);
        case 'frame':
          return onFrame(state, ctx);
        case 'view-exit':
        case 'stop': {
          const episode = state.episode;
          if (!episode) return unchanged(state);
          const why = event.type === 'stop' ? 'session end' : 'navigation';
          return settle(state, ctx, ctx.lastFrame ?? episode.lastMovingFrame, undefined, `cut short by ${why}`);
        }
        default:
          return unchanged(state);
      }
    },
  };
}

/** Scroll episode detection with the tuned defaults. */
export const ScrollLifecycleRule = scrollLifecycleRule();
