/**
 * User input, played through CDP rather than a host's automation API, so the
 * conformance suite drives every host the same way.
 */

import type { CdpTransport } from '@openuji/cdp';

export async function click(cdp: CdpTransport, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

export async function wheel(
  cdp: CdpTransport,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
  });
}
