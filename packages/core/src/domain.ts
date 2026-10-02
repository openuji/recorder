/**
 * Shared domain models across all streams and engine components.
 *
 * ## Clocks
 *
 * Arrival order — the order events reach the one fused FIFO — is the only
 * order fusion and the rules rely on. Timestamps are diagnostic, and each one
 * names its clock:
 *
 *  - `receivedAtMs`: Unix epoch ms, stamped by the transport the moment an
 *    event arrives (`CdpTransport.now`, `Date.now` unless injected). Every
 *    frame, lifecycle event and interaction carries it; it is the one clock
 *    comparable across all events. Sources never read a clock themselves.
 *  - `swapTimeMs`: Chromium's frame-swap time, Unix epoch ms (frames).
 *  - `monotonicTime`: Chromium's `MonotonicTime` — seconds since an arbitrary
 *    origin, comparable only with other `monotonicTime` values (milestones).
 *  - `pageTimeMs`: the page's `Date.now()` at the DOM event, Unix epoch ms
 *    (interactions).
 */

import type { InteractionAction, TargetElementMeta } from './wire.js';

export type CompositorFrame = Readonly<{
  index: number;
  /**
   * The encoded image, base64 — exactly as CDP delivers it. Kept encoded so
   * the many frames no rule captures are never decoded; see `decodeBase64`.
   */
  base64: string;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  pageScaleFactor: number;
  receivedAtMs: number;
  /** Absent when Chromium does not report it. */
  swapTimeMs?: number;
}>;

export type LifecycleEvent =
  | Readonly<{
      type: 'committed';
      frameId: string;
      isMainFrame: boolean;
      loaderId: string;
      url: string;
      receivedAtMs: number;
    }>
  | Readonly<{
      type: 'milestone';
      frameId: string;
      isMainFrame: boolean;
      loaderId: string;
      name:
        | 'init'
        | 'commit'
        | 'DOMContentLoaded'
        | 'load'
        | 'firstPaint'
        | 'firstContentfulPaint'
        | 'firstMeaningfulPaint'
        | 'networkAlmostIdle'
        | 'networkIdle'
        | (string & {});
      receivedAtMs: number;
      monotonicTime: number;
      /**
       * Reported by Chromium as the document's current state when lifecycle
       * reporting was enabled — not as it happened. A snapshot of the past, so
       * never a live arming signal.
       */
      replayed: boolean;
    }>;

export type InteractionEvent = Readonly<{
  action: InteractionAction;
  target: TargetElementMeta;
  receivedAtMs: number;
  pageTimeMs: number;
}>;

export type DocumentState = Readonly<{
  id: number;
  loaderId: string;
  url: string;
  firstFrameObserved: boolean;
  lastFrame: CompositorFrame | null;
}>;

export type DomainEvent =
  | Readonly<{
      type: 'committed';
      frameId: string;
      isMainFrame: boolean;
      loaderId: string;
      url: string;
      receivedAtMs: number;
    }>
  | Readonly<{
      type: 'lifecycle';
      frameId: string;
      loaderId: string;
      name: string;
      receivedAtMs: number;
      monotonicTime: number;
    }>
  | Readonly<{
      type: 'frame';
      frame: CompositorFrame;
    }>
  | Readonly<{
      type: 'interaction';
      action: InteractionAction;
      target: TargetElementMeta;
      receivedAtMs: number;
      pageTimeMs: number;
    }>
  /**
   * Synthesized by the rules engine — never produced by a stream. Emitted to
   * every rule against the *departing* document just before a new main-frame
   * document takes its place, so a rule can capture the final resting state.
   */
  | Readonly<{
      type: 'document-exit';
      documentId: number;
      loaderId: string;
      url: string;
      nextLoaderId: string;
      nextUrl: string;
      /** Taken from the commit that replaced the document. */
      receivedAtMs: number;
    }>
  | Readonly<{
      type: 'stop';
    }>;

export type MilestoneCapture = Readonly<{
  documentId: number;
  loaderId: string;
  url: string;
  label: string;
  frame: CompositorFrame;
  detail: string;
  domTarget?: TargetElementMeta;
}>;

export type InteractionLogRecord = Readonly<{
  sequence: number;
  timestamp: string; // ISO 8601
  epochMs: number;
  documentId: number;
  loaderId: string;
  url: string;
  label: string;
  screenshotFile: string;
  screenshotPath: string;
  byteLength: number;
  scroll: Readonly<{
    x: number;
    y: number;
  }>;
  detail: string;
  domTarget?: TargetElementMeta;
}>;
