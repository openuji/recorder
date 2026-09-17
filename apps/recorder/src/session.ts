import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { headlessFromEnv } from '@uxr/cli-kit';
import { drainAll, enqueueAll, type CaptureSink } from '@uxr/core';
import { RulesEngine, type MilestoneRule } from '@uxr/engine';
import { createFusedStream, defaultRules, type FusedStreamHandle } from '@uxr/fused';
import { ConsoleSink, PersistenceSink } from '@uxr/sinks';

export interface StreamWatchOptions {
  url: string;
  outputDir?: string;
  rules?: readonly MilestoneRule[];
  headless?: boolean;
  viewport?: { width: number; height: number };
  /**
   * Where captures go. Defaults to console reporting plus PNG + NDJSON
   * persistence; pass `[new ConsoleSink()]` for a detection-only run, or add
   * your own `CaptureSink`.
   */
  sinks?: readonly CaptureSink[];
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Orchestrates a full end-to-end capture session: browser, fused streams,
 * rules engine, sinks.
 */
export class StreamWatchSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private fused: FusedStreamHandle | null = null;
  private consumer: Promise<void> | null = null;
  private isStopping = false;

  private readonly engine: RulesEngine;
  private sinks: readonly CaptureSink[] = [];

  public sessionDir = '';
  public ndjsonPath = '';

  constructor(private readonly options: StreamWatchOptions) {
    this.engine = new RulesEngine(options.rules ?? defaultRules);
  }

  public async start(): Promise<void> {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionDir =
      this.options.outputDir ?? resolve('recordings', `session-${runId}`);
    await mkdir(this.sessionDir, { recursive: true });
    this.ndjsonPath = join(this.sessionDir, 'interactions.ndjson');

    this.sinks = this.options.sinks ?? [
      new ConsoleSink(),
      new PersistenceSink({
        outDir: this.sessionDir,
        logFile: this.ndjsonPath,
      }),
    ];

    console.log('Launching browser session...');
    this.browser = await chromium.launch({
      headless: this.options.headless ?? headlessFromEnv(),
      // Playwright installs its own SIGINT/SIGTERM handlers that close the browser
      // and exit the process with code 130. That races our teardown and can cut
      // the session short before the final capture is flushed, so we take over
      // signal handling entirely.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    this.context = await this.browser.newContext({
      viewport: { ...(this.options.viewport ?? DEFAULT_VIEWPORT) },
    });
    this.page = await this.context.newPage();

    console.log('Initializing fused stream pipeline...');
    const fused = await createFusedStream(this.page);
    this.fused = fused;

    this.consumer = (async () => {
      for await (const event of fused.events) {
        if (this.isStopping) break;
        for (const capture of this.engine.processEvent(event)) {
          enqueueAll(this.sinks, capture);
        }
      }
    })();

    console.log(`Navigating to ${this.options.url}...`);
    await this.page.goto(this.options.url, { waitUntil: 'commit' });
  }

  public async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    console.log('\nStopping session and finalizing writes...');

    // Flush the final resting state (99-before-navigation) before teardown.
    for (const capture of this.engine.processEvent({ type: 'stop' })) {
      enqueueAll(this.sinks, capture);
    }

    await this.fused?.stop().catch(() => {});
    await this.consumer?.catch(() => {});

    let drainError: unknown = null;
    try {
      await drainAll(this.sinks);
    } catch (err) {
      drainError = err;
    }

    await this.browser?.close().catch(() => {});

    console.log('\nSession saved:');
    console.log(`  Screenshots: ${this.sessionDir}`);
    console.log(`  NDJSON Log:  ${this.ndjsonPath}`);

    const dropped = this.fused?.stats.dropped ?? 0;
    if (dropped > 0) {
      console.warn(
        `  \x1b[33mWarning: ${dropped} compositor frame(s) dropped under backpressure.\x1b[0m`,
      );
    }

    if (drainError) throw drainError;
    console.log('Done.');
  }

  /** The live browser, once `start()` has run. Used to hook shutdown. */
  public get browserHandle(): Browser | null {
    return this.browser;
  }

  /** The page being recorded. Lets a caller drive the session programmatically. */
  public get pageHandle(): Page | null {
    return this.page;
  }

  public onDisconnect(handler: () => void): void {
    this.browser?.on('disconnected', handler);
  }
}
