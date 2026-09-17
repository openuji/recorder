#!/usr/bin/env node
import { installShutdown, runMain, targetUrlFromArgv } from '@openuji/cli-kit';
import { StreamWatchSession } from './session.js';

runMain(async () => {
  const session = new StreamWatchSession({ url: targetUrlFromArgv() });

  await session.start();

  console.log('\nReady! Full UXR recording is active:');
  console.log('  • Click any element             -> 10-pre-click + 11-post-click + DOM metadata');
  console.log('  • Scroll down or up             -> 03-pre-scroll-XX + 04-post-scroll-XX per episode');
  console.log('  • Navigate or press Ctrl+C      -> 99-before-navigation');
  console.log(`  • Logs recorded in real time to -> ${session.ndjsonPath}\n`);

  await new Promise<void>((resolve, reject) => {
    const browser = session.browserHandle;
    if (!browser) {
      reject(new Error('Session started without a browser'));
      return;
    }

    installShutdown(browser, async () => {
      try {
        await session.stop();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
});
