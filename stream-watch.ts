import {
  chromium,
  type Browser,
  type CDPSession,
  type Page,
} from 'playwright';

import {
  mkdir,
  writeFile,
} from 'node:fs/promises';

import {
  resolve,
  join,
} from 'node:path';


interface ScreencastFrame {
  data: string;
  sessionId: number;

  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;

    scrollOffsetX: number;
    scrollOffsetY: number;

    timestamp?: number;
  };
}


interface StoredFrame {
  buffer: Buffer;

  scrollX: number;
  scrollY: number;

  timestamp: number;
}


interface Navigation {
  id: number;

  url: string;

  prefix: string;

  firstFrameSaved: boolean;
  domContentLoadedSaved: boolean;
  loadSaved: boolean;
  preScrollSaved: boolean;
  beforeNavigationSaved: boolean;

  hasScrolled: boolean;

  lastFrame: StoredFrame | null;
}


class NavigationRecorder {
  private client!: CDPSession;

  private navigationIndex = 0;

  private currentNavigation:
    Navigation | null = null;

  private stopped = false;

  /*
   * Serialize file writes.
   *
   * Screencast itself continues independently.
   */
  private writeQueue =
    Promise.resolve();


  constructor(
    private page: Page,
    private outDir: string,
  ) {}


  async start(): Promise<void> {
    await mkdir(
      this.outDir,
      {
        recursive: true,
      },
    );


    this.client =
      await this.page
        .context()
        .newCDPSession(this.page);


    /*
     * --------------------------------------------------
     * Screencast
     * --------------------------------------------------
     *
     * Frames are NOT automatically written.
     *
     * They are simply our source of the latest visual
     * state of the viewport.
     */
    this.client.on(
      'Page.screencastFrame',
      rawFrame => {
        void this.onFrame(
          rawFrame as ScreencastFrame,
        );
      },
    );


    /*
     * --------------------------------------------------
     * Navigation
     * --------------------------------------------------
     */
    this.page.on(
      'framenavigated',
      frame => {
        if (
          frame !==
          this.page.mainFrame()
        ) {
          return;
        }

        const url =
          frame.url();

        if (
          !url ||
          url === 'about:blank'
        ) {
          return;
        }

        void this.beginNavigation(url);
      },
    );


    /*
     * --------------------------------------------------
     * DOMContentLoaded
     * --------------------------------------------------
     */
    this.page.on(
      'domcontentloaded',
      () => {
        void this.saveDOMContentLoaded();
      },
    );


    /*
     * --------------------------------------------------
     * load
     * --------------------------------------------------
     */
    this.page.on(
      'load',
      () => {
        void this.saveLoad();
      },
    );


    const viewport =
      this.page.viewportSize() ?? {
        width: 1280,
        height: 800,
      };


    await this.client.send(
      'Page.startScreencast',
      {
        format: 'png',

        everyNthFrame: 1,

        maxWidth:
          viewport.width,

        maxHeight:
          viewport.height,
      },
    );


    console.log(
      'Navigation screencast recorder started',
    );

    console.log(
      `Screenshots: ${this.outDir}`,
    );
  }


  /*
   * ==================================================
   * NAVIGATION
   * ==================================================
   */

  private async beginNavigation(
    url: string,
  ): Promise<void> {

    /*
     * Before replacing the current navigation,
     * preserve its final visible state.
     *
     * This is extremely useful for UXR:
     *
     * "What exactly was the user looking at immediately
     * before they left this page?"
     */
    const previous =
      this.currentNavigation;

    if (
      previous &&
      previous.lastFrame &&
      !previous.beforeNavigationSaved
    ) {
      previous.beforeNavigationSaved =
        true;

      this.queueWrite(
        previous,
        previous.lastFrame,
        '99-before-navigation',
      );
    }


    const id =
      ++this.navigationIndex;


    const timestamp =
      new Date()
        .toISOString()
        .replace(/[:.]/g, '-');


    const prefix =
      `${String(id).padStart(5, '0')}-${timestamp}`;


    this.currentNavigation = {
      id,

      url,

      prefix,

      firstFrameSaved: false,
      domContentLoadedSaved: false,
      loadSaved: false,
      preScrollSaved: false,
      beforeNavigationSaved: false,

      hasScrolled: false,

      lastFrame: null,
    };


    console.log('');
    console.log(
      `Navigation ${id}: ${url}`,
    );
  }


  /*
   * ==================================================
   * SCREencast FRAME
   * ==================================================
   */

  private async onFrame(
    frame: ScreencastFrame,
  ): Promise<void> {

    if (this.stopped) {
      return;
    }


    /*
     * ACK immediately.
     *
     * File I/O must never block Chromium.
     */
    try {
      await this.client.send(
        'Page.screencastFrameAck',
        {
          sessionId:
            frame.sessionId,
        },
      );
    } catch {
      return;
    }


    if (this.stopped) {
      return;
    }


    const nav =
      this.currentNavigation;


    if (!nav) {
      return;
    }


    const stored: StoredFrame = {
      buffer:
        Buffer.from(
          frame.data,
          'base64',
        ),

      scrollX:
        frame.metadata.scrollOffsetX,

      scrollY:
        frame.metadata.scrollOffsetY,

      timestamp:
        frame.metadata.timestamp ??
        Date.now() / 1000,
    };


    /*
     * --------------------------------------------------
     * FIRST FRAME
     * --------------------------------------------------
     *
     * First compositor output belonging to this
     * navigation.
     */
    if (!nav.firstFrameSaved) {
      nav.firstFrameSaved = true;

      this.queueWrite(
        nav,
        stored,
        '00-first',
      );
    }


    /*
     * --------------------------------------------------
     * DETECT FIRST SCROLL
     * --------------------------------------------------
     *
     * THIS IS THE IMPORTANT PART.
     *
     * Suppose:
     *
     * frame A: scrollY = 0
     * frame B: scrollY = 0
     * frame C: scrollY = 147
     *
     * When C arrives, B is exactly the visual state
     * immediately before the scroll.
     *
     * Save B.
     */
    const previous =
      nav.lastFrame;


    if (
      previous &&
      !nav.preScrollSaved &&
      (
        stored.scrollX !==
          previous.scrollX ||

        stored.scrollY !==
          previous.scrollY
      )
    ) {
      nav.hasScrolled = true;
      nav.preScrollSaved = true;


      this.queueWrite(
        nav,
        previous,
        '03-pre-scroll',
      );


      console.log(
        `  first scroll: ` +
        `${previous.scrollY} -> ` +
        `${stored.scrollY}`,
      );
    }


    /*
     * Do NOT write the frame.
     *
     * Just remember it.
     */
    nav.lastFrame =
      stored;
  }


  /*
   * ==================================================
   * DOM CONTENT LOADED
   * ==================================================
   */

  private async saveDOMContentLoaded():
    Promise<void> {

    const nav =
      this.currentNavigation;


    if (
      !nav ||
      nav.domContentLoadedSaved
    ) {
      return;
    }


    /*
     * If the user already scrolled, don't pretend
     * this represents the initial page anymore.
     *
     * We already have 00-first and 03-pre-scroll.
     */
    if (nav.hasScrolled) {
      return;
    }


    const frame =
      nav.lastFrame;


    if (!frame) {
      return;
    }


    nav.domContentLoadedSaved =
      true;


    this.queueWrite(
      nav,
      frame,
      '01-domcontentloaded',
    );
  }


  /*
   * ==================================================
   * LOAD
   * ==================================================
   */

  private async saveLoad():
    Promise<void> {

    const nav =
      this.currentNavigation;


    if (
      !nav ||
      nav.loadSaved
    ) {
      return;
    }


    /*
     * Same rule:
     *
     * don't save a "load" screenshot if the user has
     * already moved the viewport somewhere else.
     */
    if (nav.hasScrolled) {
      return;
    }


    /*
     * Give the load event one compositor cycle to
     * appear in the screencast.
     */
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          50,
        ),
    );


    if (
      this.currentNavigation !== nav ||
      nav.hasScrolled
    ) {
      return;
    }


    const frame =
      nav.lastFrame;


    if (!frame) {
      return;
    }


    nav.loadSaved =
      true;


    this.queueWrite(
      nav,
      frame,
      '02-load',
    );
  }


  /*
   * ==================================================
   * WRITE
   * ==================================================
   */

  private queueWrite(
    nav: Navigation,
    frame: StoredFrame,
    label: string,
  ): void {

    /*
     * Freeze both references NOW.
     *
     * Later navigation cannot change which frame gets
     * written.
     */
    const filename =
      join(
        this.outDir,
        `${nav.prefix}-${label}.png`,
      );


    const buffer =
      frame.buffer;


    this.writeQueue =
      this.writeQueue
        .then(async () => {

          await writeFile(
            filename,
            buffer,
          );


          console.log(
            `  saved ${label}`,
          );

          console.log(
            `    ${filename}`,
          );
        })
        .catch(err => {
          console.error(
            'Screenshot write failed:',
            err,
          );
        });
  }


  /*
   * ==================================================
   * STOP
   * ==================================================
   */

  async stop(): Promise<void> {

    if (this.stopped) {
      return;
    }


    /*
     * Preserve the final state of the final page.
     */
    const nav =
      this.currentNavigation;


    if (
      nav &&
      nav.lastFrame &&
      !nav.beforeNavigationSaved
    ) {
      nav.beforeNavigationSaved =
        true;

      this.queueWrite(
        nav,
        nav.lastFrame,
        '99-before-navigation',
      );
    }


    this.stopped = true;


    await this.client
      .send(
        'Page.stopScreencast',
      )
      .catch(() => {});


    /*
     * Finish pending writes.
     */
    await this.writeQueue;


    await this.client
      .detach()
      .catch(() => {});


    console.log(
      'Recorder stopped',
    );
  }
}


/*
 * ====================================================
 * MAIN
 * ====================================================
 */

async function main():
  Promise<void> {

  const screenshotDir =
    resolve('screenshots');


  const browser: Browser =
    await chromium.launch({
      headless: false,
    });


  const context =
    await browser.newContext({
      viewport: {
        width: 1280,
        height: 800,
      },

      deviceScaleFactor: 1,
    });


  const page =
    await context.newPage();


  const recorder =
    new NavigationRecorder(
      page,
      screenshotDir,
    );


  /*
   * Recorder BEFORE navigation.
   */
  await recorder.start();


  const startUrl =
    process.argv[2] ??
    'https://example.com';


  await page.goto(
    startUrl,
    {
      waitUntil:
        'domcontentloaded',
    },
  );


  console.log(
    `Chromium started at ${startUrl}`,
  );

  console.log(
    'Press Ctrl+C to stop.',
  );


  let shuttingDown = false;


  async function shutdown() {

    if (shuttingDown) {
      return;
    }


    shuttingDown = true;


    console.log(
      '\nStopping...',
    );


    await recorder
      .stop()
      .catch(() => {});


    await browser
      .close()
      .catch(() => {});


    process.exit(0);
  }


  process.on(
    'SIGINT',
    () => void shutdown(),
  );


  process.on(
    'SIGTERM',
    () => void shutdown(),
  );


  await new Promise<void>(
    resolvePromise => {

      browser.on(
        'disconnected',
        resolvePromise,
      );

    },
  );
}


void main().catch(
  err => {
    console.error(err);
    process.exit(1);
  },
);