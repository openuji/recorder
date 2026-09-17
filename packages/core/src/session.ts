/**
 * Shared CDP session ownership.
 *
 * The three streams are designed to run either standalone (each creating its
 * own CDP session) or fused (all three attached to one session owned by the
 * orchestrator). Getting the teardown rule wrong either detaches a session
 * still in use by a sibling stream, or leaks one. The rule lives here once.
 *
 * Structurally typed on purpose — `core` stays free of a Playwright dependency.
 */

export interface DetachableSession {
  detach(): Promise<void>;
}

export interface OwnedSession<T extends DetachableSession> {
  readonly session: T;
  /** True when this stream created the session and must tear it down. */
  readonly owned: boolean;
  /** Detach, but only if we own the session. Never throws. */
  release(): Promise<void>;
}

export function ownSession<T extends DetachableSession>(
  session: T,
  owned: boolean,
): OwnedSession<T> {
  return {
    session,
    owned,
    async release(): Promise<void> {
      if (!owned) return;
      await session.detach().catch(() => {});
    },
  };
}
