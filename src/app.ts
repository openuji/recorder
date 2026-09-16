import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MilestoneCapture } from './types.js';
import { defaultRules, type MilestoneRule } from './rules/index.js';
import { ModularRulesEngine } from './engine/rules-engine.js';
import { createFusedStream, type FusedStreamHandle } from './streams/fused.js';
import { PersistenceSink } from './sink/persistence-sink.js';

export interface StreamWatchOptions {
  url: string;
  outputDir?: string;
  rules?: readonly MilestoneRule[];
  headless?: boolean;
}

/**
 * StreamWatchSession: orchestrates the full end-to-end UXR capture session.
 */
export class StreamWatchSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private fusedHandle: FusedStreamHandle | null = null;
  private sink: PersistenceSink | null = null;
  private engine: ModularRulesEngine;
  private consumerPromise: Promise<void> | null = null;
  private isStopping = false;

  public sessionDir = '';
  public ndjsonPath = '';

  constructor(private readonly options: StreamWatchOptions) {
    this.engine = new ModularRulesEngine(options.rules ?? defaultRules);
  }

  public async start(): Promise<void> {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionDir = this.options.outputDir ?? resolve('recordings', `session-${runId}`);
    await mkdir(this.sessionDir, { recursive: true });
    this.ndjsonPath = join(this.sessionDir, 'interactions.ndjson');

    this.sink = new PersistenceSink(this.sessionDir, this.ndjsonPath);

    console.log('Launching browser session...');
    this.browser = await chromium.launch({
      headless: this.options.headless ?? false,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    this.page = await this.context.newPage();

    console.log('Initializing fused stream pipeline...');
    this.fusedHandle = await createFusedStream(this.page);

    // Consume domain events and feed into rules engine and sink
    this.consumerPromise = (async () => {
      for await (const event of this.fusedHandle.events) {
        if (this.isStopping) break;
        const captures = this.engine.processEvent(event);
        for (const capture of captures) {
          this.handleCapture(capture);
        }
      }
    })();

    console.log(`Navigating to ${this.options.url}...`);
    await this.page.goto(this.options.url, { waitUntil: 'commit' });
  }

  private handleCapture(capture: MilestoneCapture): void {
    const shortLoader = capture.loaderId.slice(0, 8);
    const sizeKb = (capture.frame.buffer.byteLength / 1024).toFixed(1);

    const isInteraction =
      capture.label.includes('click') || capture.label.includes('scroll');
    const color = isInteraction
      ? '\x1b[35m'
      : capture.label.includes('99')
        ? '\x1b[33m'
        : '\x1b[36m';

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

    this.sink?.enqueue(capture);
  }

  public async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    console.log('\nStopping session and finalizing writes...');

    // Process stop event in engine to capture final state (99-before-navigation)
    const finalCaptures = this.engine.processEvent({ type: 'stop' });
    for (const c of finalCaptures) {
      this.handleCapture(c);
    }

    if (this.fusedHandle) {
      await this.fusedHandle.stop().catch(() => {});
    }

    await this.consumerPromise?.catch(() => {});

    if (this.sink) {
      await this.sink.drain();
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    console.log(`\nSession saved:`);
    console.log(`  Screenshots: ${this.sessionDir}`);
    console.log(`  NDJSON Log:  ${this.ndjsonPath}`);
    console.log('Done.');
  }

  public onDisconnect(handler: () => void): void {
    this.browser?.on('disconnected', handler);
  }
}
