import type { CompositorFrame, DomainEvent, TargetElementMeta } from '@openuji/core';

let nextFrameIndex = 0;

/** A synthetic compositor frame. No Chromium involved. */
export function frame(
  overrides: Partial<CompositorFrame> = {},
): CompositorFrame {
  return {
    index: ++nextFrameIndex,
    base64: 'cG5n',
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 1280,
    viewportHeight: 800,
    pageScaleFactor: 1,
    receivedAtMs: 0,
    ...overrides,
  };
}

export function frameEvent(overrides: Partial<CompositorFrame> = {}): DomainEvent {
  return { type: 'frame', frame: frame(overrides) };
}

export function committed(loaderId: string, url = `https://example.com/${loaderId}`): DomainEvent {
  return {
    type: 'committed',
    frameId: 'main',
    isMainFrame: true,
    loaderId,
    url,
    receivedAtMs: 0,
  };
}

export function lifecycle(name: string, loaderId: string): DomainEvent {
  return {
    type: 'lifecycle',
    frameId: 'main',
    loaderId,
    name,
    receivedAtMs: 0,
    monotonicTime: 0,
  };
}

export function target(selector = 'a.link'): TargetElementMeta {
  return {
    tagName: selector.split(/[.#]/)[0] ?? 'a',
    selector,
    clientX: 10,
    clientY: 20,
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
  };
}

export function click(selector?: string): DomainEvent {
  return {
    type: 'interaction',
    action: 'click',
    target: target(selector),
    receivedAtMs: 0,
    pageTimeMs: 0,
  };
}

export function scrollEnd(): DomainEvent {
  return {
    type: 'interaction',
    action: 'scrollend',
    target: target('window'),
    receivedAtMs: 0,
    pageTimeMs: 0,
  };
}
