import { launchPuppeteerTarget } from '@openuji/host-puppeteer';
import { describeHostConformance } from './conformance.js';

const env = process.env;

/**
 * The pinned Chrome for Testing build by default. CI points
 * `UXR_CHROME_EXECUTABLE` at each Chrome major it exercises and sets
 * `UXR_CHROME_VERSION` to the build it installed, so a job that silently ran
 * some other Chrome fails instead of passing.
 *
 * Headed by default, as users run Chrome (CI provides a display through Xvfb).
 * `UXR_HEADLESS=1` switches to the pinned `chrome-headless-shell`.
 */
describeHostConformance('puppeteer', {
  launch: () =>
    launchPuppeteerTarget({
      headless: env['UXR_HEADLESS'] === '1' || env['UXR_HEADLESS'] === 'true',
      executablePath: env['UXR_CHROME_EXECUTABLE'],
    }),
  expectedVersion: env['UXR_CHROME_VERSION'],
});
