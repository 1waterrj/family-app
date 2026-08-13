export type FeedbackRetryOutcome = 'SUCCESS' | 'RETRY' | 'STOP';

export interface FeedbackRetryScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FeedbackRetryController {
  trigger(options?: { followUp?: boolean }): Promise<FeedbackRetryOutcome>;
  reset(): void;
  cancel(): void;
  whenIdle(): Promise<FeedbackRetryOutcome | void>;
}

export interface FeedbackRetryControllerOptions {
  attempt(): Promise<FeedbackRetryOutcome>;
  scheduler?: FeedbackRetryScheduler;
  delaysMs?: readonly number[];
}

const DEFAULT_DELAYS_MS = [5_000, 30_000, 120_000] as const;

export function createFeedbackRetryController(
  options: FeedbackRetryControllerOptions,
): FeedbackRetryController {
  const scheduler = options.scheduler ?? defaultScheduler;
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  let generation = 0;
  let nextDelayIndex = 0;
  let timer: unknown;
  let inFlight: Promise<FeedbackRetryOutcome> | undefined;
  let queuedFollowUp: Promise<FeedbackRetryOutcome> | undefined;

  function clearTimer(): void {
    if (timer === undefined) return;
    scheduler.clearTimeout(timer);
    timer = undefined;
  }

  function run(): Promise<FeedbackRetryOutcome> {
    if (inFlight) return inFlight;
    const runGeneration = generation;
    const promise = options
      .attempt()
      .then((outcome) => {
        if (generation !== runGeneration) return 'STOP';
        if (outcome === 'SUCCESS') {
          nextDelayIndex = 0;
          return outcome;
        }
        if (outcome !== 'RETRY' || nextDelayIndex >= delays.length) {
          return outcome;
        }
        const delay = delays[nextDelayIndex];
        nextDelayIndex += 1;
        timer = scheduler.setTimeout(() => {
          timer = undefined;
          void run();
        }, delay!);
        return outcome;
      })
      .finally(() => {
        if (inFlight === promise) inFlight = undefined;
      });
    inFlight = promise;
    return promise;
  }

  function invalidate(resetBackoff: boolean): void {
    generation += 1;
    clearTimer();
    inFlight = undefined;
    queuedFollowUp = undefined;
    if (resetBackoff) nextDelayIndex = 0;
  }

  return {
    trigger({ followUp = false } = {}) {
      if (inFlight) {
        if (!followUp) return inFlight;
        if (queuedFollowUp) return queuedFollowUp;
        const queuedGeneration = generation;
        queuedFollowUp = inFlight.then((outcome) => {
          queuedFollowUp = undefined;
          return generation === queuedGeneration && outcome === 'SUCCESS'
            ? run()
            : outcome;
        });
        return queuedFollowUp;
      }
      clearTimer();
      return run();
    },
    reset() {
      invalidate(true);
    },
    cancel() {
      invalidate(false);
    },
    whenIdle() {
      return inFlight ?? Promise.resolve();
    },
  };
}

const defaultScheduler: FeedbackRetryScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};
