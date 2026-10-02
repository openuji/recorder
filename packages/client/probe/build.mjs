import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientSource } from '../build-client.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));

const { bytes } = await buildClientSource({
  packageDir,
  entry: 'src/browser/cdp-binding.ts',
  outBundle: 'dist/probe.iife.js',
  outModule: 'src/generated/probe-source.ts',
  exportName: 'PROBE_SOURCE',
});

console.log(`[client-probe] bundled in-page probe (${bytes} bytes)`);
