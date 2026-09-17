import { describe, expect, it } from 'vitest';
import { createPushStream } from '../src/push-stream.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

describe('createPushStream', () => {
  it('yields values in push order', async () => {
    const stream = createPushStream<number>();
    stream.push(1);
    stream.push(2);
    stream.push(3);
    stream.end();

    expect(await collect(stream.iterable)).toEqual([1, 2, 3]);
  });

  it('drains queued values before reporting done', async () => {
    const stream = createPushStream<number>();
    stream.push(1);
    stream.push(2);
    stream.end();
    stream.push(3); // after end: ignored

    expect(await collect(stream.iterable)).toEqual([1, 2]);
  });

  it('parks the consumer until a value arrives', async () => {
    const stream = createPushStream<string>();
    const collected = collect(stream.iterable);

    await Promise.resolve();
    stream.push('late');
    stream.end();

    expect(await collected).toEqual(['late']);
  });

  it('throws from the consumer on fail()', async () => {
    const stream = createPushStream<number>();
    stream.push(1);
    stream.fail(new Error('boom'));

    await expect(collect(stream.iterable)).rejects.toThrow('boom');
  });

  it('is unbounded by default', async () => {
    const stream = createPushStream<number>();
    for (let i = 0; i < 500; i++) stream.push(i);
    stream.end();

    expect(stream.stats.dropped).toBe(0);
    expect(await collect(stream.iterable)).toHaveLength(500);
  });

  it('drops the oldest value at capacity', async () => {
    const dropped: number[] = [];
    const stream = createPushStream<number>({
      capacity: 3,
      onDrop: (value) => dropped.push(value),
    });

    for (const n of [1, 2, 3, 4, 5]) stream.push(n);
    stream.end();

    expect(dropped).toEqual([1, 2]);
    expect(stream.stats.dropped).toBe(2);
    expect(await collect(stream.iterable)).toEqual([3, 4, 5]);
  });

  it('never drops a value the evict predicate protects', async () => {
    type Item = { kind: 'frame' | 'signal'; n: number };
    const stream = createPushStream<Item>({
      capacity: 2,
      evict: (item) => item.kind === 'frame',
    });

    stream.push({ kind: 'signal', n: 1 });
    stream.push({ kind: 'frame', n: 2 });
    stream.push({ kind: 'frame', n: 3 });
    stream.push({ kind: 'frame', n: 4 });
    stream.end();

    const values = await collect(stream.iterable);
    // The signal survives; only frames were evicted.
    expect(values.filter((v) => v.kind === 'signal')).toEqual([
      { kind: 'signal', n: 1 },
    ]);
    expect(stream.stats.dropped).toBeGreaterThan(0);
  });

  it('grows past capacity rather than dropping a protected value', async () => {
    const stream = createPushStream<string>({
      capacity: 1,
      evict: () => false,
    });

    stream.push('a');
    stream.push('b');
    stream.push('c');
    stream.end();

    expect(stream.stats.dropped).toBe(0);
    expect(await collect(stream.iterable)).toEqual(['a', 'b', 'c']);
  });
});
