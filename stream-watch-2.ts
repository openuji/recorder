import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/* ============================================================
 * IMMUTABLE DOMAIN MODEL
 * ============================================================ */

type Frame = Readonly<{
  buffer: Buffer;
  scrollX: number;
  scrollY: number;
}>;

type PendingLifecycle = Readonly<{
  dom: boolean;
  load: boolean;
}>;

type DocumentState = Readonly<{
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

type Model = Readonly<{
  mainFrameId: string | null;
  nextDocumentId: number;
  documents: readonly DocumentState[];
  pendingLifecycle: Readonly<Record<string, PendingLifecycle>>;
}>;

type Effect = Readonly<{
  type: 'write';
  buffer: Buffer;
  documentId: number;
  label: string;
}>;

type Transition = Readonly<{
  model: Model;
  effects: readonly Effect[];
}>;

type RecorderEvent =
  | Readonly<{
      type: 'bootstrap';
      frameId: string;
      loaderId: string;
      url: string;
    }>
  | Readonly<{
      type: 'frame-navigated';
      frameId: string;
      parentId?: string;
      loaderId: string;
      url: string;
    }>
  | Readonly<{
      type: 'lifecycle';
      frameId: string;
      loaderId: string;
      name: string;
    }>
  | Readonly<{
      type: 'screencast-frame';
      frame: Frame;
    }>;

function initialModel(): Model {
  return {
    mainFrameId: null,
    nextDocumentId: 0,
    documents: [],
    pendingLifecycle: {},
  };
}

const EMPTY_PENDING: PendingLifecycle = {
  dom: false,
  load: false,
};

function withoutKey<T>(
  obj: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  const { [key]: _discarded, ...rest } = obj;
  return rest;
}

function replaceDocument(
  model: Model,
  index: number,
  document: DocumentState,
): Model {
  return {
    ...model,
    documents: model.documents.map((doc, i) =>
      i === index ? document : doc,
    ),
  };
}

function lastDocumentIndex(model: Model): number {
  return model.documents.length - 1;
}

function writeEffect(
  documentId: number,
  label: string,
  frame: Frame,
): Effect {
  return {
    type: 'write',
    buffer: frame.buffer,
    documentId,
    label,
  };
}

function pendingForLifecycleName(
  previous: PendingLifecycle,
  name: string,
): PendingLifecycle {
  if (name === 'DOMContentLoaded') {
    return {
      ...previous,
      dom: true,
    };
  }

  if (name === 'load') {
    return {
      ...previous,
      // If DOMContentLoaded happened before we attached, load is a safe
      // fallback milestone for the DOM snapshot as well.
      dom: true,
      load: true,
    };
  }

  return previous;
}

function commitDocument(
  model: Model,
  event: Extract<RecorderEvent, { type: 'frame-navigated' | 'bootstrap' }>,
  bootstrap: boolean,
): Transition {
  if (event.type === 'frame-navigated' && event.parentId) {
    return { model, effects: [] };
  }

  const withMainFrame: Model = {
    ...model,
    mainFrameId: event.frameId,
  };

  if (!event.url || event.url === 'about:blank' || !event.loaderId) {
    return { model: withMainFrame, effects: [] };
  }

  const lastIndex = lastDocumentIndex(withMainFrame);
  const last = lastIndex >= 0 ? withMainFrame.documents[lastIndex] : null;

  // Bootstrap is only a recovery mechanism for pages that existed before
  // this recorder attached. Never create a duplicate document for it.
  // The active loader is the identity of the currently committed document.
  // If Chromium reports the same loader again (for example while settling a
  // redirect URL), update metadata but never create a second nav id. A BFCache
  // restore after visiting another document is still a new occurrence because
  // that loader will no longer be the active last document.
  if (last && !last.finalSaved && last.loaderId === event.loaderId) {
    const updatedLast: DocumentState = {
      ...last,
      url: event.url,
    };

    return {
      model: replaceDocument(withMainFrame, lastIndex, updatedLast),
      effects: [],
    };
  }

  const effects: Effect[] = [];
  let documents = withMainFrame.documents;

  if (last && !last.finalSaved) {
    const finalizedLast: DocumentState = {
      ...last,
      finalSaved: true,
    };

    documents = documents.map((doc, i) =>
      i === lastIndex ? finalizedLast : doc,
    );

    if (last.lastFrame) {
      effects.push(
        writeEffect(
          last.id,
          '99-before-navigation',
          last.lastFrame,
        ),
      );
    }
  }

  const pending =
    withMainFrame.pendingLifecycle[event.loaderId] ?? EMPTY_PENDING;

  const id = withMainFrame.nextDocumentId + 1;

  const document: DocumentState = {
    id,
    loaderId: event.loaderId,
    url: event.url,

    firstSaved: false,
    domSaved: false,
    loadSaved: false,
    preScrollSaved: false,
    finalSaved: false,

    // For a normal commit, the next screencast frame is the first frame
    // emitted after the commit in the same CDP message stream. For a
    // bootstrap document, it is simply the earliest frame we can observe.
    captureFirstOnNextFrame: true,
    captureDomOnNextFrame: pending.dom,
    captureLoadOnNextFrame: pending.load,

    lastFrame: null,
  };

  return {
    model: {
      ...withMainFrame,
      nextDocumentId: id,
      documents: [...documents, document],
      pendingLifecycle: withoutKey(
        withMainFrame.pendingLifecycle,
        event.loaderId,
      ),
    },
    effects,
  };
}

function reduceLifecycle(
  model: Model,
  event: Extract<RecorderEvent, { type: 'lifecycle' }>,
): Transition {
  if (model.mainFrameId && event.frameId !== model.mainFrameId) {
    return { model, effects: [] };
  }

  if (
    event.name !== 'DOMContentLoaded' &&
    event.name !== 'load'
  ) {
    return { model, effects: [] };
  }

  const index = lastDocumentIndex(model);
  const active = index >= 0 ? model.documents[index] : null;

  // Lifecycle is authoritative only for the active committed document.
  // Delayed lifecycle events from an older loader cannot modify old files.
  if (!active || active.loaderId !== event.loaderId) {
    // A lifecycle event for a loader that is already in our document history
    // is a delayed event from an old document. Never let it become pending
    // state for a possible later BFCache restore of that loader.
    const alreadyHistorical = model.documents.some(
      (doc) => doc.loaderId === event.loaderId,
    );

    if (alreadyHistorical) {
      return { model, effects: [] };
    }

    const previous = model.pendingLifecycle[event.loaderId] ?? EMPTY_PENDING;
    const pending = pendingForLifecycleName(previous, event.name);

    if (pending === previous) {
      return { model, effects: [] };
    }

    return {
      model: {
        ...model,
        pendingLifecycle: {
          ...model.pendingLifecycle,
          [event.loaderId]: pending,
        },
      },
      effects: [],
    };
  }

  let updated = active;
  const effects: Effect[] = [];

  if (event.name === 'DOMContentLoaded') {
    // Immediate fallback: if we already have a valid frame for this document,
    // persist it now. Keep captureDomOnNextFrame armed so the next compositor
    // frame can overwrite it with the post-DOM frame.
    if (!updated.firstSaved && updated.lastFrame) {
      effects.push(
        writeEffect(
          updated.id,
          '00-first',
          updated.lastFrame,
        ),
      );

      updated = {
        ...updated,
        firstSaved: true,
      };
    }

    if (!updated.domSaved && updated.lastFrame) {
      effects.push(
        writeEffect(
          updated.id,
          '01-domcontentloaded',
          updated.lastFrame,
        ),
      );

      updated = {
        ...updated,
        domSaved: true,
      };
    }

    updated = {
      ...updated,
      captureFirstOnNextFrame: !updated.firstSaved,
      captureDomOnNextFrame: true,
    };
  }

  if (event.name === 'load') {
    if (!updated.firstSaved && updated.lastFrame) {
      effects.push(
        writeEffect(
          updated.id,
          '00-first',
          updated.lastFrame,
        ),
      );

      updated = {
        ...updated,
        firstSaved: true,
      };
    }

    if (!updated.domSaved && updated.lastFrame) {
      effects.push(
        writeEffect(
          updated.id,
          '01-domcontentloaded',
          updated.lastFrame,
        ),
      );

      updated = {
        ...updated,
        domSaved: true,
      };
    }

    if (!updated.loadSaved && updated.lastFrame) {
      effects.push(
        writeEffect(
          updated.id,
          '02-load',
          updated.lastFrame,
        ),
      );

      updated = {
        ...updated,
        loadSaved: true,
      };
    }

    updated = {
      ...updated,
      captureFirstOnNextFrame: !updated.firstSaved,
      captureDomOnNextFrame:
        updated.captureDomOnNextFrame || !updated.domSaved,
      captureLoadOnNextFrame: true,
    };
  }

  return {
    model: replaceDocument(model, index, updated),
    effects,
  };
}

function reduceFrame(
  model: Model,
  event: Extract<RecorderEvent, { type: 'screencast-frame' }>,
): Transition {
  const index = lastDocumentIndex(model);

  if (index < 0) {
    return { model, effects: [] };
  }

  const active = model.documents[index];
  const frame = event.frame;
  const effects: Effect[] = [];

  let updated = active;
  let firstWasSavedOnThisFrame = false;

  if (updated.captureFirstOnNextFrame && !updated.firstSaved) {
    effects.push(
      writeEffect(
        updated.id,
        '00-first',
        frame,
      ),
    );

    updated = {
      ...updated,
      firstSaved: true,
      captureFirstOnNextFrame: false,
    };

    firstWasSavedOnThisFrame = true;
  }

  if (updated.captureDomOnNextFrame) {
    effects.push(
      writeEffect(
        updated.id,
        '01-domcontentloaded',
        frame,
      ),
    );

    updated = {
      ...updated,
      domSaved: true,
      captureDomOnNextFrame: false,
    };
  }

  if (updated.captureLoadOnNextFrame) {
    effects.push(
      writeEffect(
        updated.id,
        '02-load',
        frame,
      ),
    );

    updated = {
      ...updated,
      loadSaved: true,
      captureLoadOnNextFrame: false,
    };
  }

  // Only detect scroll after this document has produced its first accepted
  // compositor frame. That prevents navigation scroll restoration/reset from
  // being mistaken for a user scroll before the page is visually established.
  if (
    updated.firstSaved &&
    !firstWasSavedOnThisFrame &&
    !updated.preScrollSaved &&
    updated.lastFrame &&
    (Math.abs(updated.lastFrame.scrollX - frame.scrollX) > 0.5 ||
      Math.abs(updated.lastFrame.scrollY - frame.scrollY) > 0.5)
  ) {
    effects.push(
      writeEffect(
        updated.id,
        '03-pre-scroll',
        updated.lastFrame,
      ),
    );

    updated = {
      ...updated,
      preScrollSaved: true,
    };
  }

  // Do not retain visual frames until the document has actually emitted its
  // accepted first frame. This is the guard against an old compositor surface
  // leaking into the newly committed document.
  if (updated.firstSaved) {
    updated = {
      ...updated,
      lastFrame: frame,
    };
  }

  return {
    model: replaceDocument(model, index, updated),
    effects,
  };
}

function reduceRecorder(
  model: Model,
  event: RecorderEvent,
): Transition {
  switch (event.type) {
    case 'bootstrap':
      return commitDocument(model, event, true);

    case 'frame-navigated':
      return commitDocument(model, event, false);

    case 'lifecycle':
      return reduceLifecycle(model, event);

    case 'screencast-frame':
      return reduceFrame(model, event);
  }
}

function finalizeModel(
  model: Model,
): Transition {
  const index = lastDocumentIndex(model);

  if (index < 0) {
    return { model, effects: [] };
  }

  const active = model.documents[index];

  if (active.finalSaved) {
    return { model, effects: [] };
  }

  const updated: DocumentState = {
    ...active,
    finalSaved: true,
  };

  const effects: Effect[] = [];

  if (active.lastFrame) {
    effects.push(
      writeEffect(
        active.id,
        '99-before-navigation',
        active.lastFrame,
      ),
    );
  }

  return {
    model: replaceDocument(model, index, updated),
    effects,
  };
}

/* ============================================================
 * IMPERATIVE SHELL
 * ============================================================ */

class NavigationRecorder {
  private client: CDPSession | null = null;
  private state: Model = initialModel();
  private stopped = false;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly page: Page,
    private readonly outDir: string,
    private readonly runId: string,
    private readonly tabId: number,
  ) {}

  async start(): Promise<void> {
    await mkdir(this.outDir, { recursive: true });

    this.client = await this.page.context().newCDPSession(this.page);

    if (this.stopped) {
      await this.client.detach().catch(() => {});
      this.client = null;
      return;
    }

    const client = this.client;

    // Register every event handler before enabling Page domain so nothing can
    // mutate the model between protocol events. dispatch() itself is sync.
    client.on('Page.frameNavigated', (raw: any) => {
      const frame = raw.frame;

      this.dispatch({
        type: 'frame-navigated',
        frameId: frame.id,
        parentId: frame.parentId,
        loaderId: frame.loaderId,
        url: frame.url,
      });
    });

    client.on('Page.lifecycleEvent', (raw: any) => {
      this.dispatch({
        type: 'lifecycle',
        frameId: raw.frameId,
        loaderId: raw.loaderId,
        name: raw.name,
      });
    });

    client.on('Page.screencastFrame', (raw: any) => {
      // State transition happens synchronously before ACK or disk I/O.
      this.dispatch({
        type: 'screencast-frame',
        frame: {
          buffer: Buffer.from(raw.data, 'base64'),
          scrollX: raw.metadata.scrollOffsetX,
          scrollY: raw.metadata.scrollOffsetY,
        },
      });

      // Transport plumbing only; never awaited by domain logic.
      void client
        .send('Page.screencastFrameAck', {
          sessionId: raw.sessionId,
        })
        .catch(() => {});
    });

    await client.send('Page.enable');

    await client.send('Page.setLifecycleEventsEnabled', {
      enabled: true,
    });

    // Recover an already-open page (important for popups/new tabs that may
    // have committed before their recorder finished attaching).
    const tree: any = await client.send('Page.getFrameTree');
    const root = tree.frameTree.frame;

    if (root?.id) {
      this.state = {
        ...this.state,
        mainFrameId: root.id,
      };
    }

    if (
      root?.id &&
      root?.loaderId &&
      root?.url &&
      root.url !== 'about:blank'
    ) {
      this.dispatch({
        type: 'bootstrap',
        frameId: root.id,
        loaderId: root.loaderId,
        url: root.url,
      });
    }

    const viewport = this.page.viewportSize() ?? {
      width: 1280,
      height: 800,
    };

    await client.send('Page.startScreencast', {
      format: 'png',
      everyNthFrame: 1,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
    });

    console.log(`Tab ${this.tabId}: recorder started`);
  }

  private dispatch(event: RecorderEvent): void {
    if (this.stopped) {
      return;
    }

    const transition = reduceRecorder(
      this.state,
      event,
    );

    this.state = transition.model;
    this.executeEffects(transition.effects);
  }

  private executeEffects(effects: readonly Effect[]): void {
    for (const effect of effects) {
      this.writeQueue = this.writeQueue
        .then(async () => {
          const filename = join(
            this.outDir,
            `tab-${String(this.tabId).padStart(3, '0')}-` +
              `${String(effect.documentId).padStart(5, '0')}-` +
              `${this.runId}-${effect.label}.png`,
          );

          await writeFile(filename, effect.buffer);

          console.log(
            `tab ${this.tabId} nav ${effect.documentId}: ${effect.label}`,
          );
        })
        .catch((err) => {
          console.error('Screenshot write failed:', err);
        });
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    // Finalize while domain events are still accepted by our state machine.
    const transition = finalizeModel(
      this.state,
    );

    this.state = transition.model;
    this.executeEffects(transition.effects);

    this.stopped = true;

    const client = this.client;

    if (client) {
      await client
        .send('Page.stopScreencast')
        .catch(() => {});
    }

    await this.writeQueue;

    if (client) {
      await client.detach().catch(() => {});
    }

    this.client = null;

    console.log(`Tab ${this.tabId}: recorder stopped`);
  }
}

/* ============================================================
 * MULTI-TAB SESSION
 * ============================================================ */

class SessionRecorder {
  private nextTabId = 1;

  private readonly recorders = new Map<Page, NavigationRecorder>();
  private readonly attaching = new Map<Page, Promise<void>>();

  constructor(
    private readonly context: BrowserContext,
    private readonly outDir: string,
    private readonly runId: string,
  ) {}

  async start(): Promise<void> {
    this.context.on('page', (page) => {
      void this.attachPage(page);
    });

    for (const page of this.context.pages()) {
      await this.attachPage(page);
    }
  }

  private attachPage(page: Page): Promise<void> {
    const existing = this.attaching.get(page);
    if (existing) {
      return existing;
    }

    if (this.recorders.has(page)) {
      return Promise.resolve();
    }

    const promise = this.attachPageInner(page).finally(() => {
      this.attaching.delete(page);
    });

    this.attaching.set(page, promise);
    return promise;
  }

  private async attachPageInner(page: Page): Promise<void> {
    if (page.isClosed()) {
      return;
    }

    const tabId = this.nextTabId++;

    const recorder = new NavigationRecorder(
      page,
      this.outDir,
      this.runId,
      tabId,
    );

    // Install close handler before awaiting start.
    page.once('close', () => {
      void this.detachPage(page, tabId);
    });

    this.recorders.set(page, recorder);

    try {
      await recorder.start();
      console.log(`Tab ${tabId}: attached`);
    } catch (err) {
      this.recorders.delete(page);
      console.error(`Could not attach tab ${tabId}:`, err);
    }
  }

  private async detachPage(page: Page, tabId: number): Promise<void> {
    const recorder = this.recorders.get(page);

    if (!recorder) {
      return;
    }

    this.recorders.delete(page);

    console.log(`Tab ${tabId}: closed`);

    await recorder.stop().catch(() => {});
  }

  async stop(): Promise<void> {
    // Let any tab attachment already in progress finish before shutting down.
    await Promise.allSettled([...this.attaching.values()]);

    const recorders = [...this.recorders.values()];
    this.recorders.clear();

    await Promise.all(
      recorders.map((recorder) => recorder.stop().catch(() => {})),
    );
  }
}

/* ============================================================
 * MAIN
 * ============================================================ */

function makeRunId(): string {
  // Filename namespace only. It is never used for ordering/correlation.
  // No timestamps participate anywhere in the recorder state machine.
  return process.env.UXR_RUN_ID ?? randomUUID().slice(0, 8);
}

async function main(): Promise<void> {
  const screenshotDir = resolve('screenshots');
  const runId = makeRunId();

  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

  const browser = await chromium.launch({
    headless: false,
    ...(executablePath ? { executablePath } : {}),
  });

  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 800,
    },
    deviceScaleFactor: 1,
  });

  // Create the initial page first, then synchronously attach its recorder
  // before navigating it. This guarantees we do not miss the first commit.
  const page = await context.newPage();

  const session = new SessionRecorder(
    context,
    screenshotDir,
    runId,
  );

  await session.start();

  const startUrl = process.argv[2] ?? 'https://example.com';

  await page.goto(startUrl, {
    waitUntil: 'domcontentloaded',
  });

  console.log('');
  console.log(`Chromium started at ${startUrl}`);
  console.log(`Screenshots: ${screenshotDir}`);
  console.log('Press Ctrl+C to stop.');

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log('\nStopping...');

    await session.stop().catch(() => {});
    await browser.close().catch(() => {});

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await new Promise<void>((resolveDisconnected) => {
    browser.on('disconnected', resolveDisconnected);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
