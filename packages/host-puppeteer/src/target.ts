import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { RecordingTarget, Unsubscribe, Viewport } from '@openuji/cdp';
import { navigateAndCommit } from './navigate.js';
import { createPuppeteerTransport } from './transport.js';

export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

export type WaitUntil = 'commit' | 'domcontentloaded' | 'load';

export interface PuppeteerTargetOptions {
  /**
   * Headless runs `chrome-headless-shell`, not full Chrome's headless mode: the
   * latter reports every screencast frame at scroll offset 0 (seen on Chrome
   * 154), which blinds the scroll rules. Defaults to headless.
   */
  readonly headless?: boolean;
  readonly viewport?: Viewport;
  /**
   * Chrome to launch. Omit for the Chrome for Testing build this Puppeteer
   * release is pinned to — the supported pairing. Set it to run against another
   * Chrome, as the compatibility suite does across majors; together with
   * `headless` it must be a `chrome-headless-shell` binary.
   */
  readonly executablePath?: string;
}

/**
 * A page in a freshly launched Chrome with its own throwaway profile.
 *
 * `browser` and `page` stay reachable for Puppeteer-specific callers (driving
 * the page in a script, say); nothing in the recording pipeline touches them.
 */
export interface PuppeteerTarget extends RecordingTarget {
  readonly viewport: Viewport;
  readonly browser: Browser;
  readonly page: Page;
  /** `waitUntil` defaults to `'commit'`, the `RecordingTarget` contract. */
  navigate(url: string, options?: { waitUntil?: WaitUntil }): Promise<void>;
}

export async function launchPuppeteerTarget(
  options: PuppeteerTargetOptions = {},
): Promise<PuppeteerTarget> {
  const viewport = { ...(options.viewport ?? DEFAULT_VIEWPORT) };

  const browser = await puppeteer.launch({
    headless: options.headless === false ? false : 'shell',
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    defaultViewport: viewport,
    // Puppeteer installs its own SIGINT/SIGTERM handlers that close the browser
    // and exit the process. That races our teardown and can cut the session
    // short before the final capture is flushed, so we take over signal
    // handling entirely.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  try {
    // Every launch gets a fresh temporary profile, so the default context is
    // already isolated; reusing its first tab avoids a stray blank window.
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    const cdp = createPuppeteerTransport(await page.createCDPSession());

    const onClosed = (listener: () => void): Unsubscribe => {
      // Closing the last window does not end the browser everywhere (macOS
      // keeps it running), so a closed tab counts as the target going away.
      let fired = false;
      const once = (): void => {
        if (fired) return;
        fired = true;
        listener();
      };

      browser.on('disconnected', once);
      page.on('close', once);
      return () => {
        browser.off('disconnected', once);
        page.off('close', once);
      };
    };

    return {
      cdp,
      viewport,
      browser,
      page,

      async navigate(url, navigateOptions = {}) {
        const waitUntil = navigateOptions.waitUntil ?? 'commit';
        if (waitUntil !== 'commit') {
          await page.goto(url, { waitUntil });
          return;
        }

        // `page.goto` cannot stop at commit, and on a slow page its timeout
        // would fail a recording that is going fine. So there is no timeout;
        // the target going away is what ends a navigation that never answers.
        let stopWatching: Unsubscribe = () => {};
        const closed = new Promise<never>((_, reject) => {
          stopWatching = onClosed(() =>
            reject(new Error(`Target closed while navigating to ${url}`)),
          );
        });
        try {
          await Promise.race([navigateAndCommit(cdp, url), closed]);
        } finally {
          stopWatching();
        }
      },

      onClosed,

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
