import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InteractionLogRecord, MilestoneCapture } from '../types.js';

export interface PersistenceSinkOptions {
  outDir: string;
  ndjsonFile: string;
}

/**
 * Serialized, non-blocking persistence sink that writes PNG screenshots
 * and appends records to an NDJSON log stream.
 */
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
