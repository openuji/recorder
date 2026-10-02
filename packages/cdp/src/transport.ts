/**
 * The one seam between the recorder and whatever is hosting Chromium.
 *
 * Playwright's `CDPSession`, an extension's `chrome.debugger`, Electron's
 * `webContents.debugger` and a raw DevTools WebSocket all reduce to this: send a
 * command, listen for events. Streams depend on nothing else, which is what
 * lets the same recording pipeline run under any of those hosts.
 *
 * Typed against `devtools-protocol`, which is types-only — it adds nothing to a
 * bundle.
 */

import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

export type CdpCommand = keyof ProtocolMapping.Commands;

/** The command's parameter list: `[]`, `[params?]` or `[params]`. */
export type CdpCommandParams<M extends CdpCommand> =
  ProtocolMapping.Commands[M]['paramsType'];

export type CdpResult<M extends CdpCommand> =
  ProtocolMapping.Commands[M]['returnType'];

export type CdpEventName = keyof ProtocolMapping.Events;

export type CdpEventParams<E extends CdpEventName> =
  ProtocolMapping.Events[E] extends [infer P] ? P : undefined;

/** Unix epoch ms. Injected wherever time is read, so tests control it. */
export type Clock = () => number;

/** What the transport knows about an event beyond its payload. */
export type CdpEventMeta = Readonly<{
  /** The transport's clock when the event arrived — one reading per event. */
  receivedAtMs: number;
}>;

export type CdpEventListener<E extends CdpEventName> = (
  params: CdpEventParams<E>,
  meta: CdpEventMeta,
) => void;

export type Unsubscribe = () => void;

/** Tears down whatever a source attached to a transport. Never closes the transport. */
export type Detach = () => Promise<void>;

/**
 * A CDP connection to a single page target.
 *
 * Contract every implementation keeps, because stream fusion depends on it:
 * events are delivered in the order Chromium sent them, and each event reaches
 * every listener for it synchronously before the next event is delivered. Each
 * event is stamped once, on arrival, and every listener sees that same stamp.
 *
 * There is deliberately no `close()`: the host that created the transport owns
 * its lifetime (see `RecordingTarget`), and streams only ever subscribe and
 * unsubscribe.
 */
export interface CdpTransport {
  send<M extends CdpCommand>(
    method: M,
    ...params: CdpCommandParams<M>
  ): Promise<CdpResult<M>>;

  on<E extends CdpEventName>(
    event: E,
    listener: CdpEventListener<E>,
  ): Unsubscribe;

  /**
   * The clock that stamps `receivedAtMs`. For the rare value a source derives
   * from a command response rather than an event, so it stays on one clock.
   */
  readonly now: Clock;
}
