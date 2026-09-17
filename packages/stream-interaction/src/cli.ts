#!/usr/bin/env node
import { runMain, runStreamCli } from '@uxr/cli-kit';
import { createInteractionStream } from './index.js';

/** Standalone interaction stream: live DOM inspection of clicks and scrolls. */
runMain(async () => {
  await runStreamCli({
    label: 'standalone interaction probe',
    ready:
      'Page ready. Click elements or scroll to see live DOM inspection. Press Ctrl+C to stop.\n',
    run: async (page) => {
      console.log('Attaching interaction probe...');
      const { events, stop } = await createInteractionStream(page);

      const consumed = (async () => {
        for await (const { action, target } of events) {
          console.log(
            `\x1b[35m[INTERACTION: ${action.toUpperCase()}]\x1b[0m ` +
              `<${target.selector}> "${target.textSnippet ?? ''}" ` +
              `role:${target.role ?? '-'} at:(${target.clientX}, ${target.clientY}) ` +
              `rect:[${target.boundingRect.width}x${target.boundingRect.height}]`,
          );
        }
      })();

      return { consumed, stop };
    },
  });
});
