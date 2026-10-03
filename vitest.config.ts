import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Run tests against package sources so `pnpm test` needs no prior build
    // (beyond the generated probe source). Subpaths come before their package:
    // a string alias also matches `<alias>/...`, and the first match wins.
    alias: {
      '@openuji/cdp/testing': pkg('./packages/cdp/src/testing.ts'),
      '@openuji/cdp': pkg('./packages/cdp/src/index.ts'),
      '@openuji/client-probe': pkg('./packages/client/probe/src/index.ts'),
      '@openuji/core/wire': pkg('./packages/core/src/wire.ts'),
      '@openuji/core': pkg('./packages/core/src/index.ts'),
      '@openuji/engine': pkg('./packages/engine/src/index.ts'),
      '@openuji/fused': pkg('./packages/fused/src/index.ts'),
      '@openuji/host-puppeteer': pkg('./packages/host-puppeteer/src/index.ts'),
      '@openuji/rules-document': pkg('./packages/rules-document/src/index.ts'),
      '@openuji/rules-interaction': pkg('./packages/rules-interaction/src/index.ts'),
      '@openuji/sinks': pkg('./packages/sinks/src/index.ts'),
      '@openuji/stream-compositor': pkg('./packages/stream-compositor/src/index.ts'),
      '@openuji/stream-interaction': pkg('./packages/stream-interaction/src/index.ts'),
      '@openuji/stream-lifecycle': pkg('./packages/stream-lifecycle/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
