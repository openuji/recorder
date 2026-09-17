import type { MilestoneCapture } from './domain.js';

/**
 * A destination for milestone captures. Sinks are optional and composable: the
 * recorder fans every capture out to whichever set it was configured with, and
 * the standalone stream CLIs use the console sink alone.
 *
 * `enqueue` must be non-blocking — it is called from inside the event consumer
 * loop, which must keep draining the fused stream. Defer real work and settle
 * it in `drain`.
 */
export interface CaptureSink {
  readonly name: string;
  enqueue(capture: MilestoneCapture): void;
  /** Await all deferred work. Rejects if any of it failed. */
  drain(): Promise<void>;
}

/** Fan one capture out to several sinks. */
export function enqueueAll(
  sinks: readonly CaptureSink[],
  capture: MilestoneCapture,
): void {
  for (const sink of sinks) {
    sink.enqueue(capture);
  }
}

/** Drain every sink, surfacing all failures rather than just the first. */
export async function drainAll(sinks: readonly CaptureSink[]): Promise<void> {
  const results = await Promise.allSettled(sinks.map((sink) => sink.drain()));

  const failures = results.flatMap((result, i) =>
    result.status === 'rejected'
      ? [`${sinks[i]?.name ?? 'sink'}: ${String(result.reason)}`]
      : [],
  );

  if (failures.length > 0) {
    throw new Error(`Sink drain failed:\n  ${failures.join('\n  ')}`);
  }
}
