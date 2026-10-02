import { describe, expect, it } from 'vitest';
import { createFakeCdpTransport } from '@openuji/cdp/testing';
import type { CaptureSink, MilestoneCapture } from '@openuji/core';
import { startRecording } from '@openuji/fused';
import { PROBE_BINDING_NAME } from '@openuji/stream-interaction';
import {
  bindingCalled,
  clickPayload,
  frameNavigated,
  lifecycleEvent,
  screencastFrame,
} from '../../cdp/test/events.js';

class MemorySink implements CaptureSink {
  public readonly name = 'memory';
  public readonly captures: MilestoneCapture[] = [];
  public drained = 0;

  constructor(private readonly failDrain = false) {}

  public enqueue(capture: MilestoneCapture): void {
    this.captures.push(capture);
  }

  public async drain(): Promise<void> {
    this.drained += 1;
    if (this.failDrain) throw new Error('disk full');
  }
}

/** Let the recording's consumer loop catch up with the queued events. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const screencast = { viewport: { width: 1280, height: 800 } };

describe('startRecording', () => {
  it('runs CDP events through the default rules into the sinks', async () => {
    const cdp = createFakeCdpTransport();
    const sink = new MemorySink();
    const recording = await startRecording(cdp, { sinks: [sink], screencast });

    frameNavigated(cdp, 'loader-a');
    screencastFrame(cdp, { data: 'Zmlyc3Q=' });
    lifecycleEvent(cdp, 'DOMContentLoaded', 'loader-a');
    screencastFrame(cdp);
    lifecycleEvent(cdp, 'networkAlmostIdle', 'loader-a');
    screencastFrame(cdp, { data: 'c2V0dGxlZA==' });
    bindingCalled(cdp, PROBE_BINDING_NAME, clickPayload('button#go'));
    screencastFrame(cdp, { data: 'YWZ0ZXI=' });
    await settle();
    await recording.stop();

    expect(sink.captures.map((c) => c.label)).toEqual([
      '00-first',
      '01-domcontentloaded',
      '02-settled',
      '10-pre-click-01',
      '11-post-click-01',
      '99-before-navigation',
    ]);

    const byLabel = new Map(sink.captures.map((c) => [c.label, c]));
    expect(byLabel.get('00-first')?.frame.base64).toBe('Zmlyc3Q=');
    // Pre-click is the resting frame *before* the click; post-click the one after.
    expect(byLabel.get('10-pre-click-01')?.frame.base64).toBe('c2V0dGxlZA==');
    expect(byLabel.get('11-post-click-01')?.frame.base64).toBe('YWZ0ZXI=');
    expect(byLabel.get('11-post-click-01')?.domTarget?.selector).toBe('button#go');
    expect(sink.drained).toBe(1);
  });

  it('is idempotent on stop', async () => {
    const cdp = createFakeCdpTransport();
    const sink = new MemorySink();
    const recording = await startRecording(cdp, { sinks: [sink], screencast });

    frameNavigated(cdp, 'loader-a');
    screencastFrame(cdp);
    await settle();

    await Promise.all([recording.stop(), recording.stop()]);
    await recording.stop();

    expect(
      sink.captures.filter((c) => c.label === '99-before-navigation'),
    ).toHaveLength(1);
    expect(sink.drained).toBe(1);
  });

  it('rejects stop when a sink fails to drain, after tearing the streams down', async () => {
    const cdp = createFakeCdpTransport();
    const recording = await startRecording(cdp, {
      sinks: [new MemorySink(true)],
      screencast,
    });

    await expect(recording.stop()).rejects.toThrow('disk full');
    expect(cdp.listenerCount()).toBe(0);
  });
});
