#!/usr/bin/env node
import { runMain, runStreamCli } from '@openuji/cli-kit';
import { RulesEngine } from '@openuji/engine';
import { ConsoleSink } from '@openuji/sinks';
import { createFusedStream } from './index.js';
import { defaultRules } from './default-rules.js';

/**
 * Fused detection mode: runs the full pipeline and prints every detected
 * milestone live, with zero disk I/O.
 */
runMain(async () => {
  const engine = new RulesEngine(defaultRules);
  const sink = new ConsoleSink();

  await runStreamCli({
    label: 'fused stream detection mode',
    ready:
      '\nReady! Live detections will print in real time without writing to disk.\n' +
      'Press Ctrl+C to stop.\n',
    run: async (page) => {
      console.log('Starting fused stream...');
      const { events, stop } = await createFusedStream(page);

      const consumed = (async () => {
        for await (const event of events) {
          for (const capture of engine.processEvent(event)) {
            sink.enqueue(capture);
          }
        }
      })();

      return {
        consumed,
        stop,
        // Flush the final resting state through the engine before the streams
        // shut down, so `99-before-navigation` still reports.
        onBeforeStop: () => {
          console.log('\nStopping fused stream...');
          for (const capture of engine.processEvent({ type: 'stop' })) {
            sink.enqueue(capture);
          }
        },
      };
    },
  });
});
