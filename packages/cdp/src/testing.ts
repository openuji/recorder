/**
 * An in-memory `CdpTransport` for exercising streams without a browser.
 *
 * Tests script Chromium's side of the conversation: `respond` sets what a
 * command returns, `emit` plays an event, and `sent` records every command the
 * code under test issued, in order.
 */

import { createCdpEventRouter } from './router.js';
import type {
  CdpCommand,
  CdpEventName,
  CdpResult,
  CdpTransport,
} from './transport.js';

export interface SentCommand {
  readonly method: string;
  readonly params: unknown;
}

export interface FakeCdpTransport extends CdpTransport {
  /** Every command sent so far, in order. */
  readonly sent: readonly SentCommand[];
  /** Methods of `sent`, for compact assertions. */
  sentMethods(): string[];
  /**
   * Script a command's result. A function receives the params; throwing from it
   * rejects the `send`. Unscripted commands resolve to `{}`, as CDP answers a
   * command with no return value.
   */
  respond<M extends CdpCommand>(
    method: M,
    result: CdpResult<M> | ((params: unknown) => CdpResult<M>),
  ): void;
  /**
   * Play an event from "Chromium". Loosely typed on purpose: tests supply only
   * the fields the code under test reads.
   */
  emit(event: CdpEventName, params?: unknown): void;
  listenerCount(event?: CdpEventName): number;
}

export function createFakeCdpTransport(): FakeCdpTransport {
  const router = createCdpEventRouter({
    // Surface listener bugs as test failures rather than log noise.
    onListenerError: (error) => {
      throw error;
    },
  });
  const sent: SentCommand[] = [];
  const responses = new Map<string, unknown>();

  const send = async (method: string, params?: unknown): Promise<unknown> => {
    sent.push({ method, params });
    if (!responses.has(method)) return {};

    const result = responses.get(method);
    return typeof result === 'function'
      ? (result as (params: unknown) => unknown)(params)
      : result;
  };

  return {
    send: send as CdpTransport['send'],
    on: router.on,
    sent,
    sentMethods: () => sent.map((command) => command.method),
    respond(method, result) {
      responses.set(method, result);
    },
    emit(event, params) {
      router.dispatch(event, params);
    },
    listenerCount: (event) => router.listenerCount(event),
  };
}
