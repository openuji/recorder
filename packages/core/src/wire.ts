/**
 * The wire contract between the in-page probe (`@openuji/client-probe`, runs in the
 * browser) and the Node-side interaction stream (`@openuji/stream-interaction`).
 *
 * This module must stay free of any Node-only types (no `Buffer`, no `node:*`)
 * so the browser tier can depend on it via the `@openuji/core/wire` subpath without
 * pulling `@types/node` into a DOM-only program.
 */

/**
 * - `scrollinput`: a person used something that scrolls — the evidence that a
 *   scroll is theirs and not the page's own doing.
 * - `scrollstart` / `scrollend`: a scroller — the page itself or any element
 *   with its own scrollbar — began and stopped moving.
 */
export type InteractionAction =
  | 'click'
  | 'input'
  | 'change'
  | 'scrollinput'
  | 'scrollstart'
  | 'scrollend';

/** What a person scrolled with. */
export type ScrollInputKind = 'wheel' | 'touch' | 'key' | 'scrollbar';

/** A scroller's offset and how far it can go, CSS px. */
export type ScrollPosition = Readonly<{
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}>;

/**
 * The selector of the page's own scroller — the viewport. Generated selectors
 * always start with a tag name, so no element can collide with it.
 */
export const VIEWPORT_SELECTOR = 'window';

/** Structural description of the DOM element an interaction targeted. */
export type TargetElementMeta = Readonly<{
  tagName: string;
  id?: string;
  className?: string;
  selector: string;
  role?: string;
  ariaLabel?: string;
  textSnippet?: string;
  href?: string;
  inputType?: string;
  name?: string;
  clientX: number;
  clientY: number;
  boundingRect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}>;

/** Exactly what the probe JSON-serializes into the CDP binding call. */
export type InteractionWirePayload = Readonly<{
  action: InteractionAction;
  /** For `scrollstart` / `scrollend`, the scroller. */
  target: TargetElementMeta;
  /** The page's `Date.now()` at the DOM event — Unix epoch ms, page clock. */
  pageTimeMs: number;
  /**
   * `scrollend`: where the scroller came to rest. `scrollstart`: where it
   * rested before, when the probe saw it at rest; absent otherwise.
   */
  scroll?: ScrollPosition;
  /** `scrollinput`: what was used. */
  input?: ScrollInputKind;
}>;
