// The Chrome builds CI runs the real-browser suite against, resolved at run time
// so the matrix follows Chrome's release train without hand-edited versions.
//
//   pinned      the Chrome for Testing build the pinned Puppeteer ships with
//   m{E} ext.   Extended Stable, what managed fleets run. Read from Chromium
//               Dash, never derived from Stable: with two-week Stable majors and
//               eight-week Extended updates it trails Stable by up to three.
//   m{N} stable current Stable, what most extension users run
//   beta        what reaches users next
//
// The extended entry installs the Chrome for Testing build of that major; CfT
// does not carry Extended's later security patches, which do not touch CDP.
//
// Each `spec` is a `puppeteer browsers install` argument; bare `chrome` is the
// pinned build. Writes `matrix=<json>` to $GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';

const CFT_KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json';
const EXTENDED_RELEASES =
  'https://chromiumdash.appspot.com/fetch_releases?channel=Extended&platform=Windows&num=1';

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const major = (version) => Number.parseInt(version, 10);

const { channels } = await fetchJson(CFT_KNOWN_GOOD);
const stable = major(channels.Stable.version);

const [extendedRelease] = await fetchJson(EXTENDED_RELEASES);
if (!extendedRelease) throw new Error(`${EXTENDED_RELEASES} listed no release`);
const extended = major(extendedRelease.version);

const matrix = [
  { name: 'pinned', spec: 'chrome' },
  // Right after Extended moves to the current major, Stable already covers it.
  ...(extended < stable
    ? [{ name: `m${extended} extended`, spec: `chrome@${extended}` }]
    : []),
  { name: `m${stable} stable`, spec: 'chrome@stable' },
  { name: 'beta', spec: 'chrome@beta' },
];

console.log(JSON.stringify(matrix, null, 2));

const output = process.env.GITHUB_OUTPUT;
if (output) appendFileSync(output, `matrix=${JSON.stringify(matrix)}\n`);
