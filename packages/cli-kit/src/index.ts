import { chromium, type Browser, type Page } from 'playwright';

export const DEFAULT_TARGET_URL = 'https://example.com';
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/** The URL to record: first positional argument, or a harmless default. */
export function targetUrlFromArgv(argv: readonly string[] = process.argv): string {
  return argv[2] ?? DEFAULT_TARGET_URL;
}

/**
 * Headed by default — these runners exist to watch a real person use a page.
 * `UXR_HEADLESS=1` exists so the CLIs can be exercised without a display.
 */
export function headlessFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['UXR_HEADLESS'];
  return value === '1' || value === 'true';
}

export interface StreamCliRun {
  /** Resolves when the consumer loop has drained the stream. */
  readonly consumed: Promise<void>;
  /** Shut the stream(s) down. */
  stop(): Promise<void>;
  /** Runs before `stop()` — e.g. to flush a final engine capture. */
  onBeforeStop?(): void | Promise<void>;
}

export interface StreamCliOptions {
  /** Shown while launching, e.g. "standalone compositor stream". */
  readonly label: string;
  /** Printed once the page has navigated. */
  readonly ready: string;
  readonly targetUrl?: string;
  readonly headless?: boolean;
  readonly waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle';
  /** Wire up the stream and start consuming it. */
  run(page: Page): Promise<StreamCliRun>;
}

/**
 * Shared harness for the standalone stream runners.
 *
 * Each stream is independently runnable by design — that is the point of the
 * three-stream split — so this exists to keep the five entry points from each
 * re-implementing browser launch, navigation and signal handling.
 */
export async function runStreamCli(options: StreamCliOptions): Promise<void> {
  const targetUrl = options.targetUrl ?? targetUrlFromArgv();

  console.log(`Launching browser (${options.label})...`);
  const browser = await chromium.launch({
    headless: options.headless ?? headlessFromEnv(),
    // Playwright installs its own SIGINT/SIGTERM handlers that close the browser
    // and exit the process with code 130. That races our teardown and can cut
    // the session short before the final capture is flushed, so we take over
    // signal handling entirely.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const context = await browser.newContext({ viewport: { ...DEFAULT_VIEWPORT } });
  const page = await context.newPage();

  const session = await options.run(page);

  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: options.waitUntil ?? 'commit' });
  console.log(options.ready);

  await new Promise<void>((resolve) => {
    installShutdown(browser, async () => {
      await session.onBeforeStop?.();
      await session.stop();
      await session.consumed.catch(() => {});
      resolve();
    });
  });

  await browser.close().catch(() => {});
  console.log('Done.');
}

/**
 * Run `teardown` once, on whichever comes first: Ctrl+C, SIGTERM, or the user
 * closing the browser window.
 */
export function installShutdown(
  browser: Browser,
  teardown: () => Promise<void>,
): void {
  let started = false;

  const once = (): void => {
    if (started) return;
    started = true;
    void teardown().catch((err) => {
      console.error('Shutdown failed:', err);
    });
  };

  process.on('SIGINT', once);
  process.on('SIGTERM', once);
  browser.on('disconnected', once);
}

/** Wrap a CLI `main` so failures exit non-zero with a readable message. */
export function runMain(main: () => Promise<void>): void {
  void main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error('Fatal error:', err);
      process.exit(1);
    },
  );
}
