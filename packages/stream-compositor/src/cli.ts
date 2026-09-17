#!/usr/bin/env node
import { runMain, runStreamCli } from '@openuji/cli-kit';
import { createCompositorStream } from './index.js';

/** Standalone compositor stream: live frame metrics, no disk writes. */
runMain(async () => {
  await runStreamCli({
    label: 'standalone compositor stream',
    ready: 'Page loaded. Scroll or interact. Press Ctrl+C to stop.\n',
    waitUntil: 'domcontentloaded',
    run: async (page) => {
      console.log('Starting compositor stream...');
      const { frames, stop } = await createCompositorStream(page);

      const consumed = (async () => {
        const startTime = Date.now();
        for await (const frame of frames) {
          const elapsedMs = (frame.timestamp - startTime).toFixed(0);
          const sizeKb = (frame.buffer.byteLength / 1024).toFixed(1);

          console.log(
            `[Frame #${String(frame.index).padStart(4, '0')}] ` +
              `+${elapsedMs.padStart(5, ' ')}ms | ` +
              `size: ${sizeKb.padStart(6, ' ')} KB | ` +
              `scroll: (${frame.scrollX}, ${frame.scrollY}) | ` +
              `viewport: ${frame.viewportWidth}x${frame.viewportHeight} @${frame.pageScaleFactor}x`,
          );
        }
      })();

      return { consumed, stop };
    },
  });
});
