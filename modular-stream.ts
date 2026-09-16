import { chromium, type CDPSession, type Page } from 'playwright';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* ============================================================
 * DOM INTERACTION & TARGET METADATA MODEL
 * ============================================================ */

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

export type Frame = Readonly<{
  index: number;
  buffer: Buffer;
  scrollX: number;
  scrollY: number;
  timestamp: number;
}>;

export type DocumentState = Readonly<{
  id: number;
  loaderId: string;
  url: string;
  firstFrameObserved: boolean;
  lastFrame: Frame | null;
}>;

/* ============================================================
 * UNIFIED DOMAIN EVENTS
 * ============================================================ */

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
      frame: Frame;
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

/* ============================================================
 * PLUGGABLE MILESTONE RULE INTERFACE
 * ============================================================ */

export type MilestoneCapture = Readonly<{
  documentId: number;
  loaderId: string;
  url: string;
  label: string;
  frame: Frame;
  detail: string;
  domTarget?: TargetElementMeta;
}>;

export interface RuleContext {
  readonly currentDocument: DocumentState;
  readonly lastFrame: Frame | null;
  readonly currentFrame: Frame | null;
}

export interface MilestoneRule<TState = any> {
  readonly id: string;

  /** Initialize or reset the rule state when a new document is committed */
  init(doc: DocumentState): TState;

  /** Pure transition: evaluates the event against the rule's current state */
  evaluate(
    state: TState,
    event: DomainEvent,
    ctx: RuleContext,
  ): {
    nextState: TState;
    captures: readonly MilestoneCapture[];
  };
}

/* ============================================================
 * CONCRETE RULES IMPLEMENTATION
 * ============================================================ */

/** Rule 1: Captures the very first visual frame of a new document */
export const FirstFrameRule: MilestoneRule<{ saved: boolean }> = {
  id: 'first-frame',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    if (state.saved || event.type !== 'frame' || !currentFrame) {
      return { nextState: state, captures: [] };
    }

    return {
      nextState: { saved: true },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '00-first',
          frame: currentFrame,
          detail: 'First visual compositor frame for this document',
        },
      ],
    };
  },
};

/** Rule 2: Captures DOMContentLoaded and load compositor frames */
export const LifecycleMilestonesRule: MilestoneRule<{
  captureDomOnNext: boolean;
  domSaved: boolean;
  captureLoadOnNext: boolean;
  loadSaved: boolean;
}> = {
  id: 'lifecycle-milestones',
  init: () => ({
    captureDomOnNext: false,
    domSaved: false,
    captureLoadOnNext: false,
    loadSaved: false,
  }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    // 1. Arm on lifecycle notifications
    if (event.type === 'lifecycle') {
      if (event.loaderId !== currentDocument.loaderId) {
        return { nextState: state, captures: [] };
      }

      if (event.name === 'DOMContentLoaded') {
        return {
          nextState: { ...state, captureDomOnNext: !state.domSaved },
          captures: [],
        };
      }
      if (event.name === 'load') {
        return {
          nextState: { ...state, captureLoadOnNext: !state.loadSaved },
          captures: [],
        };
      }
    }

    // 2. Fire on subsequent compositor frames
    if (event.type === 'frame' && currentFrame) {
      const captures: MilestoneCapture[] = [];
      let nextState = state;

      if (state.captureDomOnNext && !state.domSaved) {
        captures.push({
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '01-domcontentloaded',
          frame: currentFrame,
          detail: 'Compositor frame following DOMContentLoaded',
        });
        nextState = { ...nextState, domSaved: true, captureDomOnNext: false };
      }

      if (state.captureLoadOnNext && !state.loadSaved) {
        captures.push({
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '02-load',
          frame: currentFrame,
          detail: 'Compositor frame following page load',
        });
        nextState = { ...nextState, loadSaved: true, captureLoadOnNext: false };
      }

      return { nextState, captures };
    }

    return { nextState: state, captures: [] };
  },
};

export type ScrollRuleState = Readonly<{
  episodeCount: number;
  isScrolling: boolean;
  startFrame: Frame | null;
  lastMovingFrame: Frame | null;
  stationaryCount: number;
  postScrollEmitted: boolean;
}>;

// Minimum displacement (in px) required to consider motion an intentional user scroll
const MIN_INTENTIONAL_SCROLL_PX = 8.0;

// Number of consecutive stationary frames (~80ms at 60fps) required to declare scrolling settled
const REQUIRED_STATIONARY_FRAMES = 5;

/** Rule 3: Captures resting visual frames immediately before and after EACH scroll episode */
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
            stationaryCount: 0, // Reset stationary counter while moving
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

/** Rule 4: Captures visual frame immediately BEFORE a user click (+ DOM attributes) */
export const PreClickRule: MilestoneRule<{ clickCount: number }> = {
  id: 'pre-click',
  init: () => ({ clickCount: 0 }),
  evaluate: (state, event, { currentDocument, lastFrame }) => {
    if (
      event.type !== 'interaction' ||
      event.action !== 'click' ||
      !lastFrame
    ) {
      return { nextState: state, captures: [] };
    }

    const clickIndex = state.clickCount + 1;
    const target = event.target;

    return {
      nextState: { clickCount: clickIndex },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: `10-pre-click-${String(clickIndex).padStart(2, '0')}`,
          frame: lastFrame,
          detail: `Pre-click state on <${target.selector}> "${target.textSnippet ?? ''}"`,
          domTarget: target,
        },
      ],
    };
  },
};

/** Rule 5: Captures visual frame immediately AFTER a user click (+ DOM attributes) */
export const PostClickRule: MilestoneRule<{
  pendingTarget: TargetElementMeta | null;
  pendingClickIndex: number;
}> = {
  id: 'post-click',
  init: () => ({ pendingTarget: null, pendingClickIndex: 0 }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    // 1. Arm on click event
    if (event.type === 'interaction' && event.action === 'click') {
      return {
        nextState: {
          pendingTarget: event.target,
          pendingClickIndex: state.pendingClickIndex + 1,
        },
        captures: [],
      };
    }

    // 2. Fire on next compositor frame
    if (event.type === 'frame' && state.pendingTarget && currentFrame) {
      const target = state.pendingTarget;
      const index = state.pendingClickIndex;

      return {
        nextState: { pendingTarget: null, pendingClickIndex: index },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: `11-post-click-${String(index).padStart(2, '0')}`,
            frame: currentFrame,
            detail: `Compositor response after clicking <${target.selector}>`,
            domTarget: target,
          },
        ],
      };
    }

    return { nextState: state, captures: [] };
  },
};

/** Rule 6: Captures final visual state before navigation away or session end */
export const BeforeNavigationRule: MilestoneRule<{ saved: boolean }> = {
  id: 'before-navigation',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, lastFrame }) => {
    if (state.saved || !lastFrame) {
      return { nextState: state, captures: [] };
    }

    const isNavigatingAway =
      event.type === 'committed' &&
      event.isMainFrame &&
      event.loaderId !== currentDocument.loaderId;

    const isStopping = event.type === 'stop';

    if (isNavigatingAway || isStopping) {
      return {
        nextState: { saved: true },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: '99-before-navigation',
            frame: lastFrame,
            detail: isStopping
              ? 'Session ending; preserving final resting state'
              : `Departing page; next URL is ${(event as any).url}`,
          },
        ],
      };
    }

    return { nextState: state, captures: [] };
  },
};

/* ============================================================
 * MODULAR RULES ENGINE
 * ============================================================ */

export type EngineState = Readonly<{
  mainFrameId: string | null;
  nextDocumentId: number;
  currentDocument: DocumentState | null;
  ruleStates: Readonly<Record<string, any>>;
}>;

export class ModularRulesEngine {
  private state: EngineState;

  constructor(private readonly rules: readonly MilestoneRule[]) {
    this.state = {
      mainFrameId: null,
      nextDocumentId: 0,
      currentDocument: null,
      ruleStates: {},
    };
  }

  public processEvent(event: DomainEvent): readonly MilestoneCapture[] {
    const allCaptures: MilestoneCapture[] = [];

    // 1. If a new main document commits, initialize document state and all rules
    if (event.type === 'committed' && event.isMainFrame) {
      if (
        this.state.currentDocument &&
        this.state.currentDocument.loaderId === event.loaderId
      ) {
        // Redirection or URL update under same loader
        this.state = {
          ...this.state,
          currentDocument: {
            ...this.state.currentDocument,
            url: event.url,
          },
        };
      } else {
        // Evaluate BeforeNavigationRule on departing document before switching
        if (this.state.currentDocument) {
          const rule = this.rules.find((r) => r.id === 'before-navigation');
          if (rule) {
            const rState = this.state.ruleStates[rule.id];
            const result = rule.evaluate(rState, event, {
              currentDocument: this.state.currentDocument,
              lastFrame: this.state.currentDocument.lastFrame,
              currentFrame: null,
            });
            allCaptures.push(...result.captures);
          }
        }

        const nextId = this.state.nextDocumentId + 1;
        const newDoc: DocumentState = {
          id: nextId,
          loaderId: event.loaderId,
          url: event.url,
          firstFrameObserved: false,
          lastFrame: null,
        };

        const initialRuleStates: Record<string, any> = {};
        for (const rule of this.rules) {
          initialRuleStates[rule.id] = rule.init(newDoc);
        }

        this.state = {
          mainFrameId: event.frameId,
          nextDocumentId: nextId,
          currentDocument: newDoc,
          ruleStates: initialRuleStates,
        };

        return allCaptures;
      }
    }

    const currentDoc = this.state.currentDocument;
    if (!currentDoc) {
      return allCaptures;
    }

    const currentFrame = event.type === 'frame' ? event.frame : null;
    const lastFrame = currentDoc.lastFrame;

    const ctx: RuleContext = {
      currentDocument: currentDoc,
      lastFrame,
      currentFrame,
    };

    // 2. Evaluate all rules immutably
    const updatedRuleStates: Record<string, any> = {
      ...this.state.ruleStates,
    };

    for (const rule of this.rules) {
      const rState = updatedRuleStates[rule.id];
      const result = rule.evaluate(rState, event, ctx);
      updatedRuleStates[rule.id] = result.nextState;
      if (result.captures.length > 0) {
        allCaptures.push(...result.captures);
      }
    }

    // 3. Update current document frame tracking
    let updatedDoc = currentDoc;
    if (currentFrame) {
      updatedDoc = {
        ...updatedDoc,
        firstFrameObserved: true,
        lastFrame: currentFrame,
      };
    }

    this.state = {
      ...this.state,
      currentDocument: updatedDoc,
      ruleStates: updatedRuleStates,
    };

    return allCaptures;
  }
}

/* ============================================================
 * PERSISTENCE SINK & NDJSON LOGGER
 * ============================================================ */

export type InteractionLogRecord = Readonly<{
  sequence: number;
  timestamp: string;
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

export class PersistenceSink {
  private writeQueue = Promise.resolve();
  private sequence = 0;

  constructor(
    public readonly outDir: string,
    public readonly logFile: string,
  ) {}

  public enqueue(capture: MilestoneCapture): void {
    const seq = ++this.sequence;
    const filename = `nav-${String(capture.documentId).padStart(5, '0')}-${capture.label}.png`;
    const screenshotPath = join(this.outDir, filename);

    const record: InteractionLogRecord = {
      sequence: seq,
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      documentId: capture.documentId,
      loaderId: capture.loaderId,
      url: capture.url,
      label: capture.label,
      screenshotFile: filename,
      screenshotPath,
      byteLength: capture.frame.buffer.byteLength,
      scroll: {
        x: capture.frame.scrollX,
        y: capture.frame.scrollY,
      },
      detail: capture.detail,
      ...(capture.domTarget ? { domTarget: capture.domTarget } : {}),
    };

    const line = JSON.stringify(record) + '\n';

    this.writeQueue = this.writeQueue
      .then(async () => {
        await writeFile(screenshotPath, capture.frame.buffer);
        await appendFile(this.logFile, line, 'utf8');
      })
      .catch((err) => {
        console.error(`[Sink] Failed to write ${filename}:`, err);
      });
  }

  public async drain(): Promise<void> {
    await this.writeQueue;
  }
}

/* ============================================================
 * IN-PAGE DOM INTERACTION PROBE
 * ============================================================ */

const IN_PAGE_INTERACTION_SCRIPT = `
(() => {
  if (window.__uxr_injected__) return;
  window.__uxr_injected__ = true;

  function getSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'unknown';
    let path = el.tagName.toLowerCase();
    if (el.id) {
      return path + '#' + el.id;
    }
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
      if (classes) path += '.' + classes;
    }
    return path;
  }

  function extractMeta(e) {
    const target = e.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;

    const rect = target.getBoundingClientRect();
    const textSnippet = (target.innerText || target.value || target.getAttribute('aria-label') || '')
      .trim()
      .replace(/\\s+/g, ' ')
      .slice(0, 40);

    return {
      tagName: target.tagName.toLowerCase(),
      id: target.id || undefined,
      className: target.className && typeof target.className === 'string' ? target.className : undefined,
      selector: getSelector(target),
      role: target.getAttribute('role') || target.tagName.toLowerCase(),
      ariaLabel: target.getAttribute('aria-label') || undefined,
      textSnippet: textSnippet || undefined,
      href: target.getAttribute('href') || undefined,
      inputType: target.getAttribute('type') || undefined,
      name: target.getAttribute('name') || undefined,
      clientX: e.clientX,
      clientY: e.clientY,
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  window.addEventListener('click', (e) => {
    const meta = extractMeta(e);
    if (!meta) return;
    if (typeof window.__uxr_interaction__ === 'function') {
      window.__uxr_interaction__(JSON.stringify({
        action: 'click',
        target: meta,
        timestamp: Date.now() / 1000,
      }));
    }
  }, true);

  window.addEventListener('scrollend', (e) => {
    const meta = extractMeta(e) || {
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
    if (typeof window.__uxr_interaction__ === 'function') {
      window.__uxr_interaction__(JSON.stringify({
        action: 'scrollend',
        target: meta,
        timestamp: Date.now() / 1000,
      }));
    }
  }, true);
})();
`;

/* ============================================================
 * RUNNER / DEMO
 * ============================================================ */

async function main(): Promise<void> {
  const targetUrl = process.argv[2] ?? 'https://example.com';

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const client: CDPSession = await context.newCDPSession(page);

  // Initialize rules engine with our modular suite
  const rules = [
    FirstFrameRule,
    LifecycleMilestonesRule,
    ScrollLifecycleRule,
    PreClickRule,
    PostClickRule,
    BeforeNavigationRule,
  ];
  const engine = new ModularRulesEngine(rules);

  // Initialize recording session directory and NDJSON sink
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionDir = resolve('recordings', `session-${runId}`);
  await mkdir(sessionDir, { recursive: true });
  const ndjsonPath = join(sessionDir, 'interactions.ndjson');
  const sink = new PersistenceSink(sessionDir, ndjsonPath);

  console.log(`Recording session initialized:`);
  console.log(`  Screenshots: ${sessionDir}`);
  console.log(`  NDJSON log:  ${ndjsonPath}\n`);

  const logCapture = (capture: MilestoneCapture) => {
    const shortLoader = capture.loaderId.slice(0, 8);
    const sizeKb = (capture.frame.buffer.byteLength / 1024).toFixed(1);

    const isInteraction =
      capture.label.includes('click') || capture.label.includes('scroll');
    const color = isInteraction
      ? '\x1b[35m' // Magenta for interactions
      : capture.label.includes('99')
        ? '\x1b[33m' // Yellow for before-nav
        : '\x1b[36m'; // Cyan for standard milestones

    console.log(
      `${color}★ [NAV #${capture.documentId}] ${capture.label.padEnd(20, ' ')}\x1b[0m | ` +
        `loader: ${shortLoader} | ` +
        `frame #${capture.frame.index} (${sizeKb} KB) | ` +
        `${capture.detail}`,
    );

    if (capture.domTarget) {
      console.log(
        `    \x1b[90m↳ DOM: <${capture.domTarget.selector}> text:"${capture.domTarget.textSnippet ?? ''}" ` +
          `role:${capture.domTarget.role ?? '-'} at:(${capture.domTarget.clientX}, ${capture.domTarget.clientY}) ` +
          `rect:[${capture.domTarget.boundingRect.width}x${capture.domTarget.boundingRect.height}]\x1b[0m`,
      );
    }
  };

  const dispatch = (event: DomainEvent) => {
    const captures = engine.processEvent(event);
    for (const capture of captures) {
      logCapture(capture);
      sink.enqueue(capture);
    }
  };

  // 1. Setup CDP Runtime binding for DOM interactions
  await client.send('Runtime.enable');
  await client.send('Runtime.addBinding', { name: '__uxr_interaction__' });

  client.on('Runtime.bindingCalled', (raw: any) => {
    if (raw.name === '__uxr_interaction__') {
      try {
        const payload = JSON.parse(raw.payload);
        dispatch({
          type: 'interaction',
          action: payload.action,
          target: payload.target,
          timestamp: payload.timestamp,
        });
      } catch (err) {
        console.error('Error parsing interaction payload:', err);
      }
    }
  });

  // Inject interaction probe on every new document/iframe
  await client.send('Page.enable');
  await client.send('Page.setLifecycleEventsEnabled', { enabled: true });
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: IN_PAGE_INTERACTION_SCRIPT,
  });

  // 2. Wire Navigation Lifecycle
  client.on('Page.frameNavigated', (raw: any) => {
    const frame = raw.frame;
    dispatch({
      type: 'committed',
      frameId: frame.id,
      isMainFrame: !frame.parentId,
      loaderId: frame.loaderId,
      url: frame.url,
      timestamp: Date.now() / 1000,
    });
  });

  client.on('Page.lifecycleEvent', (raw: any) => {
    dispatch({
      type: 'lifecycle',
      frameId: raw.frameId,
      loaderId: raw.loaderId,
      name: raw.name,
      timestamp: raw.timestamp,
    });
  });

  // 3. Wire Compositor Frames with instant ACK
  let frameIndex = 0;
  client.on('Page.screencastFrame', (raw: any) => {
    dispatch({
      type: 'frame',
      frame: {
        index: ++frameIndex,
        buffer: Buffer.from(raw.data, 'base64'),
        scrollX: raw.metadata.scrollOffsetX ?? 0,
        scrollY: raw.metadata.scrollOffsetY ?? 0,
        timestamp: raw.metadata.timestamp ?? Date.now() / 1000,
      },
    });

    void client
      .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
      .catch(() => {});
  });

  // Start screencast
  await client.send('Page.startScreencast', {
    format: 'png',
    everyNthFrame: 1,
    maxWidth: 1280,
    maxHeight: 800,
  });

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'commit' });

  console.log('\nReady! Try interacting with the page:');
  console.log('  • Click any button, link, or element -> captures 10-pre-click + 11-post-click with DOM metadata');
  console.log('  • Scroll down or up                 -> captures 03-pre-scroll-XX + 04-post-scroll-XX for EACH episode');
  console.log('  • Navigate away or press Ctrl+C     -> captures 99-before-navigation\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping and finalizing session...');
    dispatch({ type: 'stop' });
    await client.send('Page.stopScreencast').catch(() => {});
    await client.detach().catch(() => {});
    await sink.drain();
    await browser.close().catch(() => {});
    console.log(`\nSession saved:`);
    console.log(`  Screenshots: ${sessionDir}`);
    console.log(`  NDJSON Log:  ${ndjsonPath}`);
    console.log('Done.');
    process.exit(0);
  };

  process.on('SIGINT', () => void teardown());
  process.on('SIGTERM', () => void teardown());
  browser.on('disconnected', () => void teardown());
}

if (process.argv[1]?.endsWith('modular-stream.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
