import {
  VIEWPORT_SELECTOR,
  type CompositorFrame,
  type ScrollPosition,
  type TargetElementMeta,
} from '@openuji/core';

/** Pure helpers of the scroll rule. */

export interface FrameMotion {
  /** Moved more than jitter on either axis. */
  readonly moving: boolean;
  /** How far, px. */
  readonly distance: number;
}

/** How the page's own scroll offset changed from one frame to the next. */
export function frameMotion(
  last: CompositorFrame,
  current: CompositorFrame,
  movementEpsilonPx: number,
): FrameMotion {
  const deltaX = Math.abs(current.scrollX - last.scrollX);
  const deltaY = Math.abs(current.scrollY - last.scrollY);

  return {
    moving: deltaX >= movementEpsilonPx || deltaY >= movementEpsilonPx,
    distance: Math.hypot(deltaX, deltaY),
  };
}

/** The page's own scroller, as the probe describes it. */
export function viewportScroller(frame: CompositorFrame): TargetElementMeta {
  return {
    tagName: 'window',
    selector: VIEWPORT_SELECTOR,
    clientX: 0,
    clientY: 0,
    boundingRect: {
      x: 0,
      y: 0,
      width: frame.viewportWidth,
      height: frame.viewportHeight,
    },
  };
}

export function isViewport(scroller: TargetElementMeta): boolean {
  return scroller.selector === VIEWPORT_SELECTOR;
}

export function sameScroller(a: TargetElementMeta, b: TargetElementMeta): boolean {
  return a.selector === b.selector;
}

/** `<div#pane>`, or `the page`. */
export function scrollerName(scroller: TargetElementMeta): string {
  return isViewport(scroller) ? 'the page' : `<${scroller.selector}>`;
}

export function at({ x, y }: Pick<ScrollPosition, 'x' | 'y'>): string {
  return `(${x}, ${y})`;
}

export function signed(px: number): string {
  return `${px >= 0 ? '+' : ''}${Math.round(px)}px`;
}
