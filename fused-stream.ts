import { chromium, type CDPSession, type Page } from 'playwright';

/* ============================================================
 * IMMUTABLE DOMAIN MODEL
 * ============================================================ */

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

  firstSaved: boolean;
  domSaved: boolean;
  loadSaved: boolean;
  preScrollSaved: boolean;
  finalSaved: boolean;

  captureFirstOnNextFrame: boolean;
  captureDomOnNextFrame: boolean;
  captureLoadOnNextFrame: boolean;

  lastFrame: Frame | null;
}>;

export type Model = Readonly<{
  mainFrameId: string | null;
  nextDocumentId: number;
  currentDocument: DocumentState | null;
}>;

export type MilestoneLabel =
  | '00-first'
  | '01-domcontentloaded'
  | '02-load'
  | '03-pre-scroll'
  | '99-before-navigation';

export type MilestoneCapture = Readonly<{
  documentId: number;
  loaderId: string;
  url: string;
  label: MilestoneLabel;
  frame: Frame;
  detail: string;
}>;

export type Transition = Readonly<{
  model: Model;
  captures: readonly MilestoneCapture[];
}>;

export type StreamEvent =
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
      type: 'stop';
    }>;

/* ============================================================
 * PURE REDUCER (Zero I/O, 100% Immutable)
 * ============================================================ */

export function initialModel(): Model {
  return {
    mainFrameId: null,
    nextDocumentId: 0,
    currentDocument: null,
  };
}

export function reduce(model: Model, event: StreamEvent): Transition {
  switch (event.type) {
    case 'committed': {
      // Ignore sub-frames (iframes) for document identity
      if (!event.isMainFrame) {
        return { model, captures: [] };
      }

      if (!event.url || event.url === 'about:blank' || !event.loaderId) {
        return {
          model: { ...model, mainFrameId: event.frameId },
          captures: [],
        };
      }

      const active = model.currentDocument;

      // Deduplicate redirects that share the same loader
      if (active && !active.finalSaved && active.loaderId === event.loaderId) {
        return {
          model: {
            ...model,
            mainFrameId: event.frameId,
            currentDocument: { ...active, url: event.url },
          },
          captures: [],
        };
      }

      const captures: MilestoneCapture[] = [];

      // 1. If there was an existing document with a valid frame, emit 99-before-navigation
      if (active && !active.finalSaved && active.lastFrame) {
        captures.push({
          documentId: active.id,
          loaderId: active.loaderId,
          url: active.url,
          label: '99-before-navigation',
          frame: active.lastFrame,
          detail: `Departing page; next URL is ${event.url}`,
        });
      }

      // 2. Instantiate the new document state
      const nextId = model.nextDocumentId + 1;
      const newDocument: DocumentState = {
        id: nextId,
        loaderId: event.loaderId,
        url: event.url,

        firstSaved: false,
        domSaved: false,
        loadSaved: false,
        preScrollSaved: false,
        finalSaved: false,

        captureFirstOnNextFrame: true,
        captureDomOnNextFrame: false,
        captureLoadOnNextFrame: false,

        lastFrame: null,
      };

      return {
        model: {
          mainFrameId: event.frameId,
          nextDocumentId: nextId,
          currentDocument: newDocument,
        },
        captures,
      };
    }

    case 'lifecycle': {
      const active = model.currentDocument;
      if (!active || active.loaderId !== event.loaderId) {
        return { model, captures: [] };
      }

      let updated = active;

      if (event.name === 'DOMContentLoaded') {
        updated = {
          ...updated,
          captureDomOnNextFrame: !updated.domSaved,
        };
      } else if (event.name === 'load') {
        updated = {
          ...updated,
          captureLoadOnNextFrame: !updated.loadSaved,
        };
      }

      return {
        model: { ...model, currentDocument: updated },
        captures: [],
      };
    }

    case 'frame': {
      const active = model.currentDocument;
      if (!active) {
        return { model, captures: [] };
      }

      const captures: MilestoneCapture[] = [];
      let updated = active;
      let firstSavedOnThisFrame = false;

      // Milestone: 00-first
      if (updated.captureFirstOnNextFrame && !updated.firstSaved) {
        captures.push({
          documentId: updated.id,
          loaderId: updated.loaderId,
          url: updated.url,
          label: '00-first',
          frame: event.frame,
          detail: `First visual compositor frame for this document`,
        });

        updated = {
          ...updated,
          firstSaved: true,
          captureFirstOnNextFrame: false,
        };
        firstSavedOnThisFrame = true;
      }

      // Milestone: 01-domcontentloaded
      if (updated.captureDomOnNextFrame && !updated.domSaved) {
        captures.push({
          documentId: updated.id,
          loaderId: updated.loaderId,
          url: updated.url,
          label: '01-domcontentloaded',
          frame: event.frame,
          detail: `Compositor frame following DOMContentLoaded`,
        });

        updated = {
          ...updated,
          domSaved: true,
          captureDomOnNextFrame: false,
        };
      }

      // Milestone: 02-load
      if (updated.captureLoadOnNextFrame && !updated.loadSaved) {
        captures.push({
          documentId: updated.id,
          loaderId: updated.loaderId,
          url: updated.url,
          label: '02-load',
          frame: event.frame,
          detail: `Compositor frame following page load`,
        });

        updated = {
          ...updated,
          loadSaved: true,
          captureLoadOnNextFrame: false,
        };
      }

      // Milestone: 03-pre-scroll (Interaction Detection!)
      // Must have already established visual frame, and scroll coordinate has moved
      if (
        updated.firstSaved &&
        !firstSavedOnThisFrame &&
        !updated.preScrollSaved &&
        updated.lastFrame &&
        (Math.abs(updated.lastFrame.scrollX - event.frame.scrollX) > 0.5 ||
          Math.abs(updated.lastFrame.scrollY - event.frame.scrollY) > 0.5)
      ) {
        captures.push({
          documentId: updated.id,
          loaderId: updated.loaderId,
          url: updated.url,
          label: '03-pre-scroll',
          // Key: Capture the resting frame immediately before scroll occurred!
          frame: updated.lastFrame,
          detail: `Scroll detected: (${updated.lastFrame.scrollX}, ${updated.lastFrame.scrollY}) -> (${event.frame.scrollX}, ${event.frame.scrollY})`,
        });

        updated = {
          ...updated,
          preScrollSaved: true,
        };
      }

      // Only retain lastFrame if the document has established its first frame
      if (updated.firstSaved) {
        updated = {
          ...updated,
          lastFrame: event.frame,
        };
      }

      return {
        model: { ...model, currentDocument: updated },
        captures,
      };
    }

    case 'stop': {
      const active = model.currentDocument;
      const captures: MilestoneCapture[] = [];

      if (active && !active.finalSaved && active.lastFrame) {
        captures.push({
          documentId: active.id,
          loaderId: active.loaderId,
          url: active.url,
          label: '99-before-navigation',
          frame: active.lastFrame,
          detail: 'Session ending; preserving final resting state of page',
        });
      }

      return {
        model: {
          ...model,
          currentDocument: active ? { ...active, finalSaved: true } : null,
        },
        captures,
      };
    }
  }
}

/* ============================================================
 * IMPERATIVE COORDINATOR (Wires CDP to Reducer)
 * ============================================================ */

export class FusedStreamCoordinator {
  private model: Model = initialModel();
  private frameCount = 0;

  constructor(
    private readonly client: CDPSession,
    private readonly onCapture: (capture: MilestoneCapture) => void,
  ) {}

  public async start(): Promise<void> {
    const client = this.client;

    // 1. Wire Frame Navigated (Committed documents)
    client.on('Page.frameNavigated', (raw: any) => {
      const frame = raw.frame;
      const isMainFrame = !frame.parentId;

      this.dispatch({
        type: 'committed',
        frameId: frame.id,
        isMainFrame,
        loaderId: frame.loaderId,
        url: frame.url,
        timestamp: Date.now() / 1000,
      });
    });

    // 2. Wire Lifecycle Events (DOMContentLoaded, load)
    client.on('Page.lifecycleEvent', (raw: any) => {
      this.dispatch({
        type: 'lifecycle',
        frameId: raw.frameId,
        loaderId: raw.loaderId,
        name: raw.name,
        timestamp: raw.timestamp,
      });
    });

    // 3. Wire Compositor Screencast Frames
    client.on('Page.screencastFrame', (raw: any) => {
      // Synchronously dispatch to state machine
      this.dispatch({
        type: 'frame',
        frame: {
          index: ++this.frameCount,
          buffer: Buffer.from(raw.data, 'base64'),
          scrollX: raw.metadata.scrollOffsetX ?? 0,
          scrollY: raw.metadata.scrollOffsetY ?? 0,
          timestamp: raw.metadata.timestamp ?? Date.now() / 1000,
        },
      });

      // Immediately ACK to maintain fluent 60fps streaming
      void client
        .send('Page.screencastFrameAck', { sessionId: raw.sessionId })
        .catch(() => {});
    });

    // Enable Page lifecycle notifications
    await client.send('Page.enable');
    await client.send('Page.setLifecycleEventsEnabled', { enabled: true });

    // Bootstrap root frame if already committed
    const tree: any = await client.send('Page.getFrameTree').catch(() => null);
    const root = tree?.frameTree?.frame;
    if (root?.id && root.loaderId && root.url && root.url !== 'about:blank') {
      this.dispatch({
        type: 'committed',
        frameId: root.id,
        isMainFrame: true,
        loaderId: root.loaderId,
        url: root.url,
        timestamp: Date.now() / 1000,
      });
    }

    // Start screencast
    await client.send('Page.startScreencast', {
      format: 'png',
      everyNthFrame: 1,
      maxWidth: 1280,
      maxHeight: 800,
    });
  }

  public dispatch(event: StreamEvent): void {
    const transition = reduce(this.model, event);
    this.model = transition.model;

    for (const capture of transition.captures) {
      this.onCapture(capture);
    }
  }

  public async stop(): Promise<void> {
    this.dispatch({ type: 'stop' });
    await this.client.send('Page.stopScreencast').catch(() => {});
    await this.client.detach().catch(() => {});
  }
}

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

  const client = await context.newCDPSession(page);

  // Capture callback handles milestone output
  const coordinator = new FusedStreamCoordinator(client, (capture) => {
    const shortLoader = capture.loaderId.slice(0, 8);
    const sizeKb = (capture.frame.buffer.byteLength / 1024).toFixed(1);

    const colors: Record<MilestoneLabel, string> = {
      '00-first': '\x1b[32m',              // Green
      '01-domcontentloaded': '\x1b[36m',    // Cyan
      '02-load': '\x1b[34m',                // Blue
      '03-pre-scroll': '\x1b[35m',          // Magenta (pre-interaction)
      '99-before-navigation': '\x1b[33m',   // Yellow (pre-interaction)
    };

    const color = colors[capture.label] ?? '\x1b[0m';

    console.log(
      `${color}★ [NAV #${capture.documentId}] ${capture.label.padEnd(21, ' ')}\x1b[0m | ` +
        `loader: ${shortLoader} | ` +
        `frame #${capture.frame.index} (${sizeKb} KB) | ` +
        `${capture.detail}`,
    );
  });

  console.log('Starting fused stream coordinator...');
  await coordinator.start();

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'commit' });

  console.log('\nReady! Try the following interactions:');
  console.log('  1. Scroll down the page      -> triggers 03-pre-scroll');
  console.log('  2. Click a link / navigate   -> triggers 99-before-navigation');
  console.log('  3. Press Ctrl+C to stop      -> triggers 99-before-navigation on current page\n');

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\nStopping coordinator...');
    await coordinator.stop();
    await browser.close().catch(() => {});
    console.log('Done.');
    process.exit(0);
  };

  process.on('SIGINT', () => void teardown());
  process.on('SIGTERM', () => void teardown());
  browser.on('disconnected', () => void teardown());
}

if (process.argv[1]?.endsWith('fused-stream.ts')) {
  void main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
