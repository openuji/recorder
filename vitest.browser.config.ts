import { defineConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * The real-browser compatibility suite (`pnpm test:browser`): the same package
 * sources as `pnpm test`, run against a launched Chrome. Kept out of the default
 * run so `pnpm test` never needs a browser.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ['test/browser/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
