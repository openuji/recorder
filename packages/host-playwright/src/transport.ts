import type { CDPSession } from 'playwright';
import {
  createCdpEventRouter,
  type CdpTransport,
  type Unsubscribe,
} from '@openuji/cdp';

/**
 * `CdpTransport` over a Playwright `CDPSession`.
 *
 * Subscribes once to the session's catch-all `'event'` and fans out through the
 * shared router — the same path the extension and Electron hosts take — so
 * ordering and listener isolation behave identically on every host.
 *
 * Playwright types CDP against its own protocol snapshot; this adapter is the
 * one place the two meet, so the casts live here.
 */
export function createPlaywrightTransport(
  session: CDPSession,
): CdpTransport & { dispose: Unsubscribe } {
  const router = createCdpEventRouter();

  const onEvent = ({ method, params }: { method: string; params?: object }) => {
    router.dispatch(method, params);
  };
  session.on('event', onEvent);

  const send = (method: string, params?: object): Promise<unknown> =>
    (session.send as (method: string, params?: object) => Promise<unknown>)(
      method,
      params,
    );

  return {
    send: send as CdpTransport['send'],
    on: router.on,
    dispose: () => {
      session.off('event', onEvent);
    },
  };
}
