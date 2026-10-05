/**
 * In-page DOM interaction probe — the observation core.
 *
 * Observes user interactions in the capture phase and hands each one, as a
 * wire payload, to whatever `report` it was installed with. It knows nothing
 * about how the payload leaves the page: the CDP binding entry
 * (`cdp-binding.ts`) is one delivery channel, an extension content script
 * relaying over `chrome.runtime` would be another.
 *
 * Listeners are registered in the capture phase so an interaction is reported
 * even when the page stops propagation on its own handlers.
 */

import {
  VIEWPORT_SELECTOR,
  type InteractionAction,
  type InteractionWirePayload,
  type ScrollInputKind,
  type ScrollPosition,
  type TargetElementMeta,
} from '@openuji/core/wire';
import {
  MAX_SELECTOR_CLASSES,
  MAX_TEXT_SNIPPET_LENGTH,
  PROBE_INJECTED_FLAG,
  SCROLL_INPUT_INTERVAL_MS,
} from '../constants.js';

/** Receives each observed interaction. Must not throw into the page. */
export type ProbeReporter = (payload: InteractionWirePayload) => void;

const WHITESPACE = /\s+/g;

function buildSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();

  if (element.id) {
    return `${tag}#${element.id}`;
  }

  // SVG elements carry an SVGAnimatedString here, not a string — skip those.
  if (typeof element.className !== 'string') {
    return tag;
  }

  const classes = element.className
    .trim()
    .split(WHITESPACE)
    .filter(Boolean)
    .slice(0, MAX_SELECTOR_CLASSES)
    .join('.');

  return classes ? `${tag}.${classes}` : tag;
}

function readTextSnippet(element: Element): string | undefined {
  // Falsy-chained, not nullish-chained: an element with empty `innerText` (any
  // input, for one) must fall through to its value and then its aria-label.
  const value =
    (element as HTMLElement).innerText ||
    (element as HTMLInputElement).value ||
    element.getAttribute('aria-label') ||
    '';

  const snippet = value
    .trim()
    .replace(WHITESPACE, ' ')
    .slice(0, MAX_TEXT_SNIPPET_LENGTH);

  return snippet || undefined;
}

/** An absent *or empty* attribute reads as undefined, so it is omitted. */
function optionalAttribute(
  element: Element,
  attribute: string,
): string | undefined {
  return element.getAttribute(attribute) || undefined;
}

function describeElement(
  element: Element,
  coordinates: { clientX: number; clientY: number },
): TargetElementMeta {
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();

  return {
    tagName: tag,
    id: element.id || undefined,
    className:
      typeof element.className === 'string'
        ? element.className || undefined
        : undefined,
    selector: buildSelector(element),
    role: optionalAttribute(element, 'role') ?? tag,
    ariaLabel: optionalAttribute(element, 'aria-label'),
    textSnippet: readTextSnippet(element),
    href: optionalAttribute(element, 'href'),
    inputType: optionalAttribute(element, 'type'),
    name: optionalAttribute(element, 'name'),
    clientX: coordinates.clientX,
    clientY: coordinates.clientY,
    boundingRect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

/** Fallback used when an event's target is not an element (e.g. the document). */
function describeViewport(): TargetElementMeta {
  return {
    tagName: 'window',
    selector: VIEWPORT_SELECTOR,
    clientX: 0,
    clientY: 0,
    boundingRect: {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}

function targetOf(event: Event): TargetElementMeta | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  // Only pointer-ish events carry coordinates; scroll events do not.
  const mouse = event as Partial<MouseEvent>;
  return describeElement(target, {
    clientX: mouse.clientX ?? 0,
    clientY: mouse.clientY ?? 0,
  });
}

/** A scroll event's scroller: an element, or the page itself (the document). */
function describeScroller(scroller: EventTarget): TargetElementMeta {
  return scroller instanceof Element
    ? describeElement(scroller, { clientX: 0, clientY: 0 })
    : describeViewport();
}

function positionOf(scroller: EventTarget): ScrollPosition {
  if (scroller instanceof Element) {
    return {
      x: Math.round(scroller.scrollLeft),
      y: Math.round(scroller.scrollTop),
      maxX: scroller.scrollWidth - scroller.clientWidth,
      maxY: scroller.scrollHeight - scroller.clientHeight,
    };
  }

  // The page. Injected at document start, the probe can run before there is
  // any root element to measure.
  const root = document.scrollingElement ?? document.documentElement;
  return {
    x: Math.round(window.scrollX),
    y: Math.round(window.scrollY),
    maxX: root ? root.scrollWidth - root.clientWidth : 0,
    maxY: root ? root.scrollHeight - root.clientHeight : 0,
  };
}

/** Keys that scroll whatever has focus, unless they are typing. */
const SCROLL_KEYS = new Set([
  ' ',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

/** The press landed on an element's scrollbar, not its content. */
function onScrollbar(event: PointerEvent): boolean {
  const element = event.target;
  if (!(element instanceof Element)) return false;
  return (
    (element.clientWidth > 0 && event.offsetX > element.clientWidth) ||
    (element.clientHeight > 0 && event.offsetY > element.clientHeight)
  );
}

/**
 * Starts observing, reporting each interaction through `report`. Returns a
 * disposer that stops observing.
 *
 * A second install into the same document is a no-op (the returned disposer
 * does nothing), so the probe can be injected more than once safely — e.g. on
 * new documents and again into the one already showing.
 */
export function installProbe(report: ProbeReporter): () => void {
  if (window[PROBE_INJECTED_FLAG]) return () => {};
  window[PROBE_INJECTED_FLAG] = true;

  const emit = (
    action: InteractionAction,
    target: TargetElementMeta,
    extra: Pick<InteractionWirePayload, 'scroll' | 'input'> = {},
  ): void => {
    report({
      action,
      target,
      pageTimeMs: Date.now(),
      ...extra,
    });
  };

  const onClick = (event: Event): void => {
    const target = targetOf(event);
    if (target) emit('click', target);
  };

  // Scrolling — of the page or of any element with its own scrollbar. A
  // `scroll` event already finds the scroller moved, so where it started is
  // what was last seen of it at rest: at its last `scrollend`, at the scroll
  // input under it, or — the page — at install. Never seen at rest, it is not
  // reported rather than guessed.
  const scrolling = new WeakSet<EventTarget>();
  const resting = new WeakMap<EventTarget, ScrollPosition>();
  // The page's position is known before its first scroll; an element's is not
  // until it has scrolled once.
  resting.set(document, positionOf(document));

  const onScroll = (event: Event): void => {
    const scroller = event.target;
    if (!scroller || scrolling.has(scroller)) return;
    scrolling.add(scroller);
    const scroll = resting.get(scroller);
    emit('scrollstart', describeScroller(scroller), scroll ? { scroll } : {});
  };

  // Where the scrollers under `from` rest, for the ones not known yet. Not at
  // the wheel itself: by then the compositor may have scrolled already. The
  // pointer arriving, a touch starting and a scroll key going down all come
  // before the scroll. Once known, every move ends in a `scrollend` that
  // keeps it current.
  const noteResting = (from: EventTarget | null): void => {
    for (
      let element = from instanceof Element ? from : null;
      element;
      element = element.parentElement
    ) {
      if (resting.has(element) || scrolling.has(element)) continue;
      if (
        element.scrollHeight > element.clientHeight ||
        element.scrollWidth > element.clientWidth
      ) {
        resting.set(element, positionOf(element));
      }
    }
  };

  const onScrollEnd = (event: Event): void => {
    const scroller = event.target;
    if (!scroller) return;
    scrolling.delete(scroller);
    const scroll = positionOf(scroller);
    resting.set(scroller, scroll);
    emit('scrollend', describeScroller(scroller), { scroll });
  };

  // Scroll input: what tells a person's scroll from the page's own. Passive,
  // so the probe never holds up a scroll the compositor could run on its own.
  let lastInputAt = -Infinity;
  const reportInput = (input: ScrollInputKind, event: Event): void => {
    const now = Date.now();
    if (now - lastInputAt < SCROLL_INPUT_INTERVAL_MS) return;
    lastInputAt = now;
    emit('scrollinput', targetOf(event) ?? describeViewport(), { input });
  };

  const onWheel = (event: Event): void => reportInput('wheel', event);
  const onTouchMove = (event: Event): void => reportInput('touch', event);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.key) && !isEditable(event.target)) {
      noteResting(event.target);
      reportInput('key', event);
    }
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (onScrollbar(event)) reportInput('scrollbar', event);
  };
  const onPointerOver = (event: Event): void => noteResting(event.target);
  const onTouchStart = (event: Event): void => noteResting(event.target);

  const passive = { capture: true, passive: true } as const;

  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, passive);
  window.addEventListener('scrollend', onScrollEnd, passive);
  window.addEventListener('wheel', onWheel, passive);
  window.addEventListener('touchmove', onTouchMove, passive);
  window.addEventListener('keydown', onKeyDown, passive);
  window.addEventListener('pointerdown', onPointerDown, passive);
  window.addEventListener('pointerover', onPointerOver, passive);
  window.addEventListener('touchstart', onTouchStart, passive);

  return () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('scrollend', onScrollEnd, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerover', onPointerOver, true);
    window.removeEventListener('touchstart', onTouchStart, true);
    window[PROBE_INJECTED_FLAG] = false;
  };
}
