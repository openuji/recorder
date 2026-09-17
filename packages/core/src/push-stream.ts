/**
 * A single-consumer push-to-pull adapter.
 *
 * Every stream in this project is fed by a synchronous CDP event handler but is
 * consumed by an `for await` loop. This primitive is the one bridge between the
 * two; it replaces four hand-rolled copies of the same queue.
 *
 * Semantics (load-bearing — see the invariants in the architecture notes):
 *  - Strict FIFO. Arrival order is the only order.
 *  - Single consumer. One pending resolver is parked at a time; concurrent
 *    `next()` calls on the same iterator are not supported.
 *  - `end()` drains. Items already queued are yielded before `done` is
 *    reported, so a shutdown never discards captured work.
 */

export interface PushStreamStats {
  /** Values accepted into the queue. */
  readonly pushed: number;
  /** Values evicted by the capacity policy. */
  readonly dropped: number;
}

export interface PushStreamOptions<T> {
  /**
   * Maximum queued values before the eviction policy kicks in. Omit for an
   * unbounded queue.
   */
  capacity?: number;
  /**
   * Which queued values may be evicted when at capacity. Values for which this
   * returns `false` are never dropped. Omit to allow evicting anything.
   */
  evict?: (value: T) => boolean;
  /** Notified for each evicted value, with the running drop total. */
  onDrop?: (value: T, totalDropped: number) => void;
}

export interface PushStream<T> {
  readonly iterable: AsyncIterable<T>;
  /** Enqueue a value. A no-op once the stream is ended or failed. */
  push(value: T): void;
  /** Close the stream. Queued values are still drained by the consumer. */
  end(): void;
  /** Close the stream by throwing `error` from the consumer's `next()`. */
  fail(error: unknown): void;
  readonly closed: boolean;
  readonly stats: PushStreamStats;
}

type Slot<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'end' }
  | { readonly kind: 'error'; readonly error: unknown };

export function createPushStream<T>(
  options: PushStreamOptions<T> = {},
): PushStream<T> {
  const { capacity, evict, onDrop } = options;

  const queue: Slot<T>[] = [];
  let pendingResolver: (() => void) | null = null;
  let closed = false;
  let pushed = 0;
  let dropped = 0;

  const notify = (): void => {
    const resolve = pendingResolver;
    if (resolve) {
      pendingResolver = null;
      resolve();
    }
  };

  /** Drop the oldest evictable value. Returns false if nothing may be dropped. */
  const evictOldest = (): boolean => {
    for (let i = 0; i < queue.length; i++) {
      const slot = queue[i];
      if (!slot || slot.kind !== 'value') continue;
      if (evict && !evict(slot.value)) continue;

      queue.splice(i, 1);
      dropped += 1;
      onDrop?.(slot.value, dropped);
      return true;
    }
    return false;
  };

  const push = (value: T): void => {
    if (closed) return;

    if (capacity !== undefined && capacity > 0 && queue.length >= capacity) {
      // If nothing is evictable we deliberately grow past capacity: dropping a
      // non-evictable value (a lifecycle or interaction signal a rule is armed
      // on) corrupts the recording, while a brief overshoot only costs memory.
      evictOldest();
    }

    queue.push({ kind: 'value', value });
    pushed += 1;
    notify();
  };

  const close = (slot: Slot<T>): void => {
    if (closed) return;
    closed = true;
    queue.push(slot);
    notify();
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          for (;;) {
            const slot = queue.shift();
            if (slot) {
              if (slot.kind === 'value') {
                return { value: slot.value, done: false };
              }
              if (slot.kind === 'error') {
                throw slot.error;
              }
              return { value: undefined, done: true };
            }

            if (closed) {
              return { value: undefined, done: true };
            }

            await new Promise<void>((resolve) => {
              pendingResolver = resolve;
            });
          }
        },
      };
    },
  };

  return {
    iterable,
    push,
    end: () => close({ kind: 'end' }),
    fail: (error: unknown) => close({ kind: 'error', error }),
    get closed() {
      return closed;
    },
    stats: {
      get pushed() {
        return pushed;
      },
      get dropped() {
        return dropped;
      },
    },
  };
}
