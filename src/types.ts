/**
 * Shared domain models across all streams and engine components.
 */

export type CompositorFrame = Readonly<{
  index: number;
  buffer: Buffer;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  pageScaleFactor: number;
  timestamp: number; // Unix epoch ms
}>;

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

export type LifecycleEvent =
  | Readonly<{
      type: 'committed';
      frameId: string;
      isMainFrame: boolean;
      loaderId: string;
      url: string;
      timestamp: number; // Monotonic seconds from Chromium
    }>
  | Readonly<{
      type: 'milestone';
      frameId: string;
      isMainFrame: boolean;
      loaderId: string;
      name:
        | 'commit'
        | 'DOMContentLoaded'
        | 'load'
        | 'firstPaint'
        | 'firstContentfulPaint'
        | 'firstMeaningfulPaint'
        | 'networkAlmostIdle'
        | 'networkIdle'
        | string;
      timestamp: number;
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
      timestamp: number;
    }>
  | Readonly<{
      type: 'lifecycle';
      frameId: string;
      loaderId: string;
      name: string;
      timestamp: number;
    }>
  | Readonly<{
      type: 'frame';
      frame: CompositorFrame;
    }>
  | Readonly<{
      type: 'interaction';
      action: 'click' | 'input' | 'change' | 'scrollend';
      target: TargetElementMeta;
      timestamp: number;
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
