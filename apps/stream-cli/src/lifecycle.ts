#!/usr/bin/env node
import { runMain, runStreamCli } from '@openuji/cli-kit';
import { createLifecycleStream } from '@openuji/stream-lifecycle';

const RESET = '\x1b[0m';

const elapsed = (ms: number): string => `+${ms.toFixed(0).padStart(6, ' ')}ms`;

/**
 * Standalone lifecycle stream: live navigation and paint milestones.
 *
 * Lines print in arrival order — the order fusion uses. The `+…ms` column is
 * host receipt time since the first event; milestones also show `chrome +…ms`,
 * Chromium's own clock since the first milestone, which need not be in arrival
 * order.
 */
runMain(async () => {
  await runStreamCli({
    label: 'standalone lifecycle stream',
    ready: 'Page navigated. Interact with links/forms. Press Ctrl+C to stop.\n',
    run: async (target) => {
      console.log('Starting lifecycle stream...');
      const { events, stop } = await createLifecycleStream(target.cdp);

      const consumed = (async () => {
        let baseline: number | null = null;
        let chromeBaseline: number | null = null;

        for await (const event of events) {
          baseline ??= event.receivedAtMs;

          const scope = event.isMainFrame ? '[MainFrame]' : '[SubFrame ]';
          const ids =
            `frame: ${event.frameId.slice(0, 8)} | ` +
            `loader: ${event.loaderId.slice(0, 8)}`;
          const received = elapsed(event.receivedAtMs - baseline);

          if (event.type === 'navigated') {
            const kind = event.sameDocument
              ? ` (same document, ${event.navigationType ?? 'other'})`
              : '';
            console.log(
              `\x1b[32m${scope} NAVIGATED${RESET}${kind} | ${ids} | ${received} | ` +
                `url: ${event.url}`,
            );
            continue;
          }

          chromeBaseline ??= event.monotonicTime;
          const chrome = elapsed((event.monotonicTime - chromeBaseline) * 1000);

          const isPaint =
            event.name === 'firstPaint' ||
            event.name === 'firstContentfulPaint';
          const isDom =
            event.name === 'DOMContentLoaded' || event.name === 'load';
          const color = isPaint ? '\x1b[33m' : isDom ? '\x1b[36m' : '\x1b[90m';

          console.log(
            `${color}${scope} MILESTONE: ${event.name.padEnd(29, ' ')}${RESET} | ` +
              `${ids} | ${received} | chrome ${chrome}`,
          );
        }
      })();

      return { consumed, stop };
    },
  });
});
