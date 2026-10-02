#!/usr/bin/env node
import { runMain, runStreamCli } from '@openuji/cli-kit';
import { createLifecycleStream } from '@openuji/stream-lifecycle';

/** Standalone lifecycle stream: live navigation and paint milestones. */
runMain(async () => {
  await runStreamCli({
    label: 'standalone lifecycle stream',
    ready: 'Page navigated. Interact with links/forms. Press Ctrl+C to stop.\n',
    run: async (target) => {
      console.log('Starting lifecycle stream...');
      const { events, stop } = await createLifecycleStream(target.cdp);

      const consumed = (async () => {
        let baseline: number | null = null;

        for await (const event of events) {
          baseline ??= event.timestamp;

          const elapsedMs = ((event.timestamp - baseline) * 1000).toFixed(0);
          const target = event.isMainFrame ? '[MainFrame]' : '[SubFrame ]';
          const loader = event.loaderId.slice(0, 8);

          if (event.type === 'committed') {
            console.log(
              `\x1b[32m${target} COMMITTED\x1b[0m | ` +
                `loaderId: ${loader} | ` +
                `+${elapsedMs.padStart(6, ' ')}ms | ` +
                `url: ${event.url}`,
            );
            continue;
          }

          const isPaint =
            event.name === 'firstPaint' ||
            event.name === 'firstContentfulPaint';
          const isDom =
            event.name === 'DOMContentLoaded' || event.name === 'load';
          const color = isPaint ? '\x1b[33m' : isDom ? '\x1b[36m' : '\x1b[90m';

          console.log(
            `${color}${target} MILESTONE: ${event.name.padEnd(20, ' ')}\x1b[0m | ` +
              `loaderId: ${loader} | ` +
              `+${elapsedMs.padStart(6, ' ')}ms`,
          );
        }
      })();

      return { consumed, stop };
    },
  });
});
