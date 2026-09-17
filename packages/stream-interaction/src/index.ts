import type { CDPSession, Page } from 'playwright';
import {
  createPushStream,
  ownSession,
  type InteractionEvent,
  type InteractionWirePayload,
  type PushStreamStats,
} from '@uxr/core';
import { PROBE_BINDING_NAME, PROBE_SOURCE } from '@uxr/client-probe';

export interface InteractionStreamHandle {
  events: AsyncIterable<InteractionEvent>;
  stop: () => Promise<void>;
  readonly stats: PushStreamStats;
}

/**
 * Installs the in-page probe and streams the user interactions it reports.
 *
 * The probe (`@uxr/client-probe`) runs in the page and calls back through a CDP
 * binding; this side owns the binding, the injection, and the decoding. Like
 * the lifecycle stream it never drops — a click is an arming signal a rule is
 * waiting on.
 */
export async function createInteractionStream(
  page: Page,
  existingClient?: CDPSession,
): Promise<InteractionStreamHandle> {
  const owned = ownSession(
    existingClient ?? (await page.context().newCDPSession(page)),
    !existingClient,
  );
  const client = owned.session;

  const stream = createPushStream<InteractionEvent>();

  const onBindingCalled = (raw: { name: string; payload: string }): void => {
    if (stream.closed || raw.name !== PROBE_BINDING_NAME) return;

    let payload: InteractionWirePayload;
    try {
      payload = JSON.parse(raw.payload) as InteractionWirePayload;
    } catch (err) {
      console.error('Failed to parse interaction payload:', err);
      return;
    }

    stream.push({
      action: payload.action,
      target: payload.target,
      timestamp: payload.timestamp,
    });
  };

  client.on('Runtime.bindingCalled', onBindingCalled);

  await client.send('Runtime.enable');
  await client.send('Runtime.addBinding', { name: PROBE_BINDING_NAME });

  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: PROBE_SOURCE,
  });

  const stop = async (): Promise<void> => {
    if (stream.closed) return;

    client.off('Runtime.bindingCalled', onBindingCalled);
    await owned.release();

    stream.end();
  };

  return { events: stream.iterable, stop, stats: stream.stats };
}

export { PROBE_BINDING_NAME, PROBE_SOURCE } from '@uxr/client-probe';
