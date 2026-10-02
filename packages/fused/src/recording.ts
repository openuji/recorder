import type { CdpTransport } from '@openuji/cdp';
import {
  drainAll,
  enqueueAll,
  type CaptureSink,
  type PushStreamStats,
} from '@openuji/core';
import { RulesEngine, type MilestoneRule } from '@openuji/engine';
import { defaultRules } from './default-rules.js';
import { createFusedStream, type FusedStreamOptions } from './fused.js';

export interface RecordingOptions extends FusedStreamOptions {
  /** Defaults to `defaultRules`. */
  rules?: readonly MilestoneRule[];
  /** Where captures go. */
  sinks: readonly CaptureSink[];
}

export interface RecordingHandle {
  /**
   * Flush the final resting state, stop the streams and drain every sink.
   * Rejects if any sink failed. Idempotent.
   */
  stop(): Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * The whole recording pipeline over a transport: fused stream → rules engine →
 * sinks. Host-agnostic — the CLI, an Electron main process and an extension
 * service worker all run exactly this.
 */
export async function startRecording(
  cdp: CdpTransport,
  options: RecordingOptions,
): Promise<RecordingHandle> {
  const { rules = defaultRules, sinks, ...fusedOptions } = options;
  const engine = new RulesEngine(rules);

  const fused = await createFusedStream(cdp, fusedOptions);
  let isStopping = false;

  const consumer = (async () => {
    for await (const event of fused.events) {
      if (isStopping) break;
      for (const capture of engine.processEvent(event)) {
        enqueueAll(sinks, capture);
      }
    }
  })();

  let stopped: Promise<void> | null = null;

  const stop = (): Promise<void> =>
    (stopped ??= (async () => {
      isStopping = true;

      // Flush the final resting state (99-before-navigation) before teardown.
      for (const capture of engine.processEvent({ type: 'stop' })) {
        enqueueAll(sinks, capture);
      }

      await fused.stop().catch(() => {});
      await consumer.catch(() => {});

      await drainAll(sinks);
    })());

  return { stop, stats: fused.stats };
}
