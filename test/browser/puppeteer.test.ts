import { describe, expect, it } from 'vitest';
import type { CdpTransport } from '@openuji/cdp';
import { launchPuppeteerTarget } from '@openuji/host-puppeteer';
import { describeHostConformance } from './conformance.js';

const env = process.env;
const headless = env['UXR_HEADLESS'] === '1' || env['UXR_HEADLESS'] === 'true';
const executablePath = env['UXR_CHROME_EXECUTABLE'];

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
  launch: () => launchPuppeteerTarget({ headless, executablePath }),
  expectedVersion: env['UXR_CHROME_VERSION'],
});

/** `<innerWidth>x<innerHeight>@<devicePixelRatio>` of the page. */
async function layoutOf(cdp: CdpTransport): Promise<string> {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: '`${innerWidth}x${innerHeight}@${devicePixelRatio}`',
    returnByValue: true,
  });
  return result.value as string;
}

describe.skipIf(headless)('puppeteer host, headed', () => {
  it('lays the page out to its window, as a person sees it', async () => {
    const target = await launchPuppeteerTarget({
      headless: false,
      executablePath,
      viewport: { width: 1000, height: 700 },
    });
    try {
      expect(target.viewport).toBeUndefined();
      // Scale factor 1 even on a HiDPI screen, where any other blanks the
      // screencast's scroll offsets.
      expect(await layoutOf(target.cdp)).toBe('1000x700@1');

      // As if the user dragged the window smaller: a fixed viewport would keep
      // the page at 1000x700 and clip it.
      await target.page.resize({ contentWidth: 900, contentHeight: 600 });
      expect(await layoutOf(target.cdp)).toBe('900x600@1');
    } finally {
      await target.close();
    }
  });
});
