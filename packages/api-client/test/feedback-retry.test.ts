import { describe, expect, it, vi } from 'vitest';

import {
  createFeedbackRetryController,
  type FeedbackRetryScheduler,
} from '../src/feedback-retry.js';

function fakeScheduler(): FeedbackRetryScheduler & {
  delays: number[];
  runNext(): void;
  pending(): number;
} {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    delays,
    setTimeout(callback, delayMs) {
      nextId += 1;
      callbacks.set(nextId, callback);
      delays.push(delayMs);
      return nextId;
    },
    clearTimeout(handle) {
      callbacks.delete(handle as number);
    },
    runNext() {
      const next = callbacks.entries().next().value as
        [number, () => void] | undefined;
      if (!next) throw new Error('No retry is pending.');
      callbacks.delete(next[0]);
      next[1]();
    },
    pending: () => callbacks.size,
  };
}

describe('feedback retry controller', () => {
  it('uses the bounded deterministic 5s, 30s, and 2m retry sequence', async () => {
    // Break caught: a persistent 5xx spins rapidly or schedules unbounded timers.
    const scheduler = fakeScheduler();
    const attempt = vi.fn().mockResolvedValue('RETRY');
    const retry = createFeedbackRetryController({ scheduler, attempt });

    await retry.trigger();
    expect(scheduler.delays).toEqual([5_000]);
    scheduler.runNext();
    await retry.whenIdle();
    expect(scheduler.delays).toEqual([5_000, 30_000]);
    scheduler.runNext();
    await retry.whenIdle();
    expect(scheduler.delays).toEqual([5_000, 30_000, 120_000]);
    scheduler.runNext();
    await retry.whenIdle();

    expect(attempt).toHaveBeenCalledTimes(4);
    expect(scheduler.pending()).toBe(0);
  });

  it('cancels pending work and ignores a late old-generation failure', async () => {
    // Break caught: logout or unmount leaves a timer, or a stale request schedules cross-scope delivery.
    const scheduler = fakeScheduler();
    let resolveAttempt!: (outcome: 'RETRY') => void;
    const attempt = vi.fn(
      () =>
        new Promise<'RETRY'>((resolve) => {
          resolveAttempt = resolve;
        }),
    );
    const retry = createFeedbackRetryController({ scheduler, attempt });

    const pendingAttempt = retry.trigger();
    retry.reset();
    resolveAttempt('RETRY');
    await pendingAttempt;

    expect(scheduler.pending()).toBe(0);
    const cancelledAttempt = retry.trigger();
    retry.cancel();
    resolveAttempt('RETRY');
    await cancelledAttempt;
    expect(scheduler.pending()).toBe(0);
  });

  it('coalesces an in-flight trigger and accelerates one pending retry', async () => {
    // Break caught: online and visibility signals duplicate an active request or retain a needless long delay.
    const scheduler = fakeScheduler();
    let resolveAttempt!: (outcome: 'RETRY' | 'SUCCESS') => void;
    const attempt = vi.fn(
      () =>
        new Promise<'RETRY' | 'SUCCESS'>((resolve) => {
          resolveAttempt = resolve;
        }),
    );
    const retry = createFeedbackRetryController({ scheduler, attempt });

    const first = retry.trigger();
    const coalesced = retry.trigger();
    expect(attempt).toHaveBeenCalledTimes(1);
    resolveAttempt('RETRY');
    await Promise.all([first, coalesced]);
    expect(scheduler.pending()).toBe(1);

    const accelerated = retry.trigger();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toBe(0);
    resolveAttempt('SUCCESS');
    await accelerated;
    expect(scheduler.pending()).toBe(0);
  });
});
