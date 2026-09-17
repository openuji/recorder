/**
 * Globals CDP installs into the page, plus the probe's own re-injection guard.
 * Declared rather than feature-probed so the browser tier typechecks.
 */

declare global {
  interface Window {
    /** Set by the probe itself; a second injection sees it and bails. */
    __uxr_injected__?: boolean;
    /** Installed by CDP `Runtime.addBinding`; absent until the binding lands. */
    __uxr_interaction__?: (payload: string) => void;
  }
}

export {};
