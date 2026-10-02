import type { CdpTransport, Unsubscribe } from './transport.js';

/** CSS viewport size, in pixels. */
export type Viewport = Readonly<{
  width: number;
  height: number;
}>;

/**
 * A page being recorded, as handed out by a host.
 *
 * The host creates the transport and is the only code that ends it, through
 * `close()`. What closing means is the host's business: a launched browser is
 * shut down, an extension merely detaches its debugger from a tab the user
 * keeps.
 */
export interface RecordingTarget {
  readonly cdp: CdpTransport;
  /**
   * Known when the host controls the viewport (a launched browser), absent when
   * it does not (an attached tab) — the compositor then asks CDP instead.
   */
  readonly viewport?: Viewport;
  /** Resolves once the navigation has committed. */
  navigate(url: string): Promise<void>;
  /** Fires once if the target goes away on its own: browser closed, tab closed, debugger detached. */
  onClosed(listener: () => void): Unsubscribe;
  close(): Promise<void>;
}
