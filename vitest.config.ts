import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Run tests against package sources so `pnpm test` needs no prior build.
    alias: {
      '@openuji/core': pkg('./packages/core/src/index.ts'),
      '@openuji/engine': pkg('./packages/engine/src/index.ts'),
      '@openuji/rules-document': pkg('./packages/rules-document/src/index.ts'),
      '@openuji/rules-interaction': pkg('./packages/rules-interaction/src/index.ts'),
      '@openuji/sinks': pkg('./packages/sinks/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
