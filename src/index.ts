import { StreamWatchSession } from './app.js';

export * from './types.js';
export * from './rules/index.js';
export * from './engine/rules-engine.js';
export * from './streams/compositor.js';
export * from './streams/lifecycle.js';
export * from './streams/interaction.js';
export * from './streams/fused.js';
export * from './sink/persistence-sink.js';
export * from './app.js';

async function main(): Promise<void> {
  const targetUrl = process.argv[2] ?? 'https://example.com';

  const session = new StreamWatchSession({
    url: targetUrl,
  });

  await session.start();

  console.log('\nReady! Full UXR recording is active:');
  console.log('  • Click any element             -> 10-pre-click + 11-post-click + DOM metadata');
  console.log('  • Scroll down or up             -> 03-pre-scroll-XX + 04-post-scroll-XX per episode');
  console.log('  • Navigate or press Ctrl+C      -> 99-before-navigation');
  console.log(`  • Logs recorded in real time to -> ${session.ndjsonPath}\n`);

  let isExiting = false;
  const teardown = async () => {
    if (isExiting) return;
    isExiting = true;
    await session.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void teardown());
  process.on('SIGTERM', () => void teardown());
  session.onDisconnect(() => void teardown());
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void main().catch((err) => {
    console.error('Fatal session error:', err);
    process.exit(1);
  });
}
