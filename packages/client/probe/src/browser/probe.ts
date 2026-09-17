/**
 * In-page DOM interaction probe.
 *
 * Runs inside the recorded page, injected via CDP
 * `Page.addScriptToEvaluateOnNewDocument`. It observes user interactions in the
 * capture phase and hands each one to Node through the
 * `Runtime.addBinding` function, JSON-encoded.
 *
 * Listeners are registered in the capture phase so an interaction is reported
 * even when the page stops propagation on its own handlers.
 */

import type {
  InteractionAction,
  InteractionWirePayload,
  TargetElementMeta,
} from '@openuji/core/wire';
import {
  MAX_SELECTOR_CLASSES,
  MAX_TEXT_SNIPPET_LENGTH,
  PROBE_BINDING_NAME,
  PROBE_INJECTED_FLAG,
} from '../constants.js';

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
    selector: 'window',
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

function report(action: InteractionAction, target: TargetElementMeta): void {
  const send = window[PROBE_BINDING_NAME];
  if (typeof send !== 'function') {
    // The binding has not landed yet — drop rather than buffer, matching the
    // Node side's expectation that the probe is fire-and-forget.
    return;
  }

  const payload: InteractionWirePayload = {
    action,
    target,
    timestamp: Date.now() / 1000,
  };

  send(JSON.stringify(payload));
}

function install(): void {
  if (window[PROBE_INJECTED_FLAG]) return;
  window[PROBE_INJECTED_FLAG] = true;

  window.addEventListener(
    'click',
    (event) => {
      const target = targetOf(event);
      if (target) report('click', target);
    },
    true,
  );

  window.addEventListener(
    'scrollend',
    (event) => {
      report('scrollend', targetOf(event) ?? describeViewport());
    },
    true,
  );
}

install();
