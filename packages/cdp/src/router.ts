/**
 * Per-method event fan-out for hosts that expose one generic event callback.
 *
 * `chrome.debugger.onEvent` and Electron's `debugger.on('message')` each hand
 * over every CDP event through a single listener; a host adapter feeds that
 * listener into `dispatch` and gets `CdpTransport.on` semantics back.
 *
 * Dispatch is synchronous and in arrival order — the ordering guarantee the
 * fused stream is built on. A throwing listener is isolated and reported, so
 * one broken source cannot starve its siblings of the same event.
 */

import type {
  CdpEventListener,
  CdpEventName,
  Unsubscribe,
} from './transport.js';

export interface CdpEventRouter {
  on<E extends CdpEventName>(
    event: E,
    listener: CdpEventListener<E>,
  ): Unsubscribe;
  /** Deliver one event to every listener registered for `method`. */
  dispatch(method: string, params: unknown): void;
  /** Registered listeners for `method`, or across all methods when omitted. */
  listenerCount(method?: string): number;
}

export interface CdpEventRouterOptions {
  /** Called when a listener throws. Defaults to `console.error`. */
  onListenerError?: (error: unknown, method: string) => void;
}

type AnyListener = (params: unknown) => void;

export function createCdpEventRouter(
  options: CdpEventRouterOptions = {},
): CdpEventRouter {
  const onListenerError =
    options.onListenerError ??
    ((error: unknown, method: string) => {
      console.error(`CDP listener for ${method} threw:`, error);
    });

  const listeners = new Map<string, Set<AnyListener>>();

  return {
    on(event, listener) {
      const handler = listener as AnyListener;
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);

      return () => {
        set.delete(handler);
        if (set.size === 0 && listeners.get(event) === set) {
          listeners.delete(event);
        }
      };
    },

    dispatch(method, params) {
      const set = listeners.get(method);
      if (!set) return;

      // Snapshot, so a listener that unsubscribes (or subscribes) mid-dispatch
      // does not change who receives this event.
      for (const listener of [...set]) {
        try {
          listener(params);
        } catch (error) {
          onListenerError(error, method);
        }
      }
    },

    listenerCount(method) {
      if (method !== undefined) return listeners.get(method)?.size ?? 0;
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}
