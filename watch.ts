import {
  chromium,
  type Browser,
  type CDPSession,
  type Page,
} from 'playwright';

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class NavigationRecorder {
  private client!: CDPSession;

  private index = 0;
  private stopped = false;

  /*
   * Incremented for every navigation.
   *
   * If navigation A is still waiting for the page to settle
   * and navigation B starts, A gets cancelled.
   */
  private navigationId = 0;

  constructor(
    private page: Page,
    private outDir: string,
  ) {}

  async start(): Promise<void> {
    await mkdir(this.outDir, {
      recursive: true,
    });

    this.client =
      await this.page.context().newCDPSession(this.page);

    /*
     * Trigger ONLY from real main-frame navigation.
     *
     * No screenshots for:
     * - mouse movement
     * - hover
     * - scrolling
     * - animations
     * - DOM changes
     */
    this.page.on('framenavigated', frame => {
      if (frame !== this.page.mainFrame()) {
        return;
      }

      const id = ++this.navigationId;

      void this.captureWhenSettled(id);
    });

    console.log('Navigation recorder started');
    console.log(`Screenshots: ${this.outDir}`);
  }

  private async captureWhenSettled(
    navigationId: number,
  ): Promise<void> {
    try {
      /*
       * 1. Wait for the normal load event.
       */
      await this.page.waitForLoadState('load');

      if (
        this.stopped ||
        navigationId !== this.navigationId
      ) {
        return;
      }

      /*
       * 2. Wait for web fonts.
       *
       * Otherwise you can capture while fallback fonts
       * are still being replaced.
       */
      await this.page.evaluate(async () => {
        if (document.fonts) {
          await document.fonts.ready;
        }
      });

      if (
        this.stopped ||
        navigationId !== this.navigationId
      ) {
        return;
      }

      /*
       * 3. Give asynchronous requests/widgets time
       * to finish.
       *
       * networkidle means there have been no network
       * connections for approximately 500 ms.
       *
       * Some sites never reach networkidle because of
       * analytics, polling, etc., hence the timeout.
       */
      await this.page
        .waitForLoadState('networkidle', {
          timeout: 5000,
        })
        .catch(() => {});

      if (
        this.stopped ||
        navigationId !== this.navigationId
      ) {
        return;
      }

      /*
       * 4. One final quiet period.
       *
       * This is important for components that render
       * after their fetch/XHR has completed.
       *
       * It does NOT cause additional screenshots.
       */
      await this.page.waitForTimeout(750);

      if (
        this.stopped ||
        navigationId !== this.navigationId
      ) {
        return;
      }

      /*
       * Give Chromium two actual rendering frames.
       *
       * This makes sure React/Vue/etc. updates that were
       * queued after the network response have made it
       * to the compositor.
       */
      await this.page.evaluate(
        () =>
          new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          }),
      );

      if (
        this.stopped ||
        navigationId !== this.navigationId
      ) {
        return;
      }

      await this.capture();

    } catch (err) {
      /*
       * Navigation may have changed while we were waiting.
       * That's fine: the newer navigation will be captured.
       */
      if (!this.stopped) {
        console.error(
          'Navigation capture failed:',
          err,
        );
      }
    }
  }

  private async capture(): Promise<void> {
    const url = this.page.url();

    if (
      !url ||
      url === 'about:blank'
    ) {
      return;
    }

    const result =
      await this.client.send(
        'Page.captureScreenshot',
        {
          format: 'png',

          /*
           * Current visible viewport only.
           */
          captureBeyondViewport: false,

          fromSurface: true,
        },
      );

    const number =
      String(++this.index)
        .padStart(5, '0');

    const timestamp =
      new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    const filename = join(
      this.outDir,
      `${number}-${timestamp}.png`,
    );

    await writeFile(
      filename,
      Buffer.from(
        result.data,
        'base64',
      ),
    );

    console.log(
      `Screenshot ${this.index}: ${url}`,
    );

    console.log(
      `  ${filename}`,
    );
  }

  async stop(): Promise<void> {
    if (this.stopped) return;

    this.stopped = true;

    /*
     * Invalidates anything currently waiting.
     */
    ++this.navigationId;

    await this.client
      .detach()
      .catch(() => {});
  }
}
async function main(): Promise<void> {
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
   * Install listener BEFORE initial navigation,
   * so initial page is captured too.
   */
  await recorder.start();

  const startUrl =
    process.argv[2] ??
    'https://example.com';

  await page.goto(
    startUrl,
    {
      waitUntil: 'load',
    },
  );

  console.log(
    `Chromium started at ${startUrl}`,
  );

  console.log(
    'Screenshots happen ONLY on navigation/reload.',
  );

  console.log(
    'Press Ctrl+C to stop.',
  );

  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;

    shuttingDown = true;

    console.log('\nStopping...');

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

void main().catch(err => {
  console.error(err);
  process.exit(1);
});