import { chromium, type Browser, type Page } from 'playwright';
import type { RecordingTarget, Unsubscribe, Viewport } from '@openuji/cdp';
import { createPlaywrightTransport } from './transport.js';

export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

export type WaitUntil = 'commit' | 'domcontentloaded' | 'load' | 'networkidle';

export interface PlaywrightTargetOptions {
  /** Omit for Playwright's default (headless). */
  readonly headless?: boolean;
  readonly viewport?: Viewport;
}

/**
 * A page in a freshly launched Chromium with its own isolated browser context.
 *
 * `browser` and `page` stay reachable for Playwright-specific callers (driving
 * the page in a script, say); nothing in the recording pipeline touches them.
 */
export interface PlaywrightTarget extends RecordingTarget {
  readonly viewport: Viewport;
  readonly browser: Browser;
  readonly page: Page;
  /** `waitUntil` defaults to `'commit'`, the `RecordingTarget` contract. */
  navigate(url: string, options?: { waitUntil?: WaitUntil }): Promise<void>;
}

export async function launchPlaywrightTarget(
  options: PlaywrightTargetOptions = {},
): Promise<PlaywrightTarget> {
  const viewport = { ...(options.viewport ?? DEFAULT_VIEWPORT) };

  const browser = await chromium.launch({
    ...(options.headless !== undefined ? { headless: options.headless } : {}),
    // Playwright installs its own SIGINT/SIGTERM handlers that close the browser
    // and exit the process with code 130. That races our teardown and can cut
    // the session short before the final capture is flushed, so we take over
    // signal handling entirely.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const cdp = createPlaywrightTransport(session);

    return {
      cdp,
      viewport,
      browser,
      page,

      async navigate(url, navigateOptions = {}) {
        await page.goto(url, {
          waitUntil: navigateOptions.waitUntil ?? 'commit',
        });
      },

      onClosed(listener): Unsubscribe {
        browser.on('disconnected', listener);
        return () => {
          browser.off('disconnected', listener);
        };
      },

      async close() {
        cdp.dispose();
        await browser.close().catch(() => {});
      },
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}
