import { describe, expect, it, vi } from 'vitest';

import {
  createDiagnosticBuffer,
  createDiagnosticFetch,
} from '../src/diagnostics.js';

const requestId = '11111111-1111-4111-8111-111111111111';

describe('diagnostic buffer', () => {
  it('rejects values outside the contracted diagnostic allowlist', () => {
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
    });

    expect(() =>
      buffer.recordApiResult({
        operation: 'CREATE_FEEDBACK',
        outcome: 'ERROR',
        status: 422,
        errorCode: 'VALIDATION_ERROR',
        durationBucket: 'UNDER_1_SECOND',
        requestId,
        requestBody: 'must not be accepted',
      } as never),
    ).toThrow();
    expect(buffer.snapshot().events).toEqual([]);
  });

  it('keeps only the most recent fifteen minutes of allowlisted events', () => {
    let now = Date.parse('2026-08-10T12:00:00.000Z');
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
      now: () => now,
    });

    buffer.recordScreen('SETUP');
    now += 15 * 60 * 1_000 + 1;
    buffer.recordNetwork('OFFLINE');

    expect(buffer.snapshot()).toMatchObject({
      currentScreen: 'SETUP',
      events: [{ kind: 'NETWORK', state: 'OFFLINE' }],
    });
  });

  it('resets all prior-scope events and validates the new safe screen', () => {
    // Break caught: a new household report can retain the prior household's screens and correlation IDs.
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    buffer.recordScreen('PARENT_FEEDBACK_DETAIL');
    buffer.recordApiResult({
      operation: 'GET_FEEDBACK',
      outcome: 'ERROR',
      status: 503,
      errorCode: 'INTERNAL_ERROR',
      durationBucket: 'UNDER_1_SECOND',
      requestId,
    });

    buffer.reset('PARENT_HOME');

    expect(buffer.snapshot()).toEqual({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
      currentScreen: 'PARENT_HOME',
      events: [],
    });
    expect(() => buffer.reset('PRIVATE_FAMILY_SCREEN' as never)).toThrow();
    expect(buffer.snapshot().currentScreen).toBe('PARENT_HOME');
  });

  it('evicts oldest events at the 100-event and 24 KiB limits', () => {
    let now = Date.parse('2026-08-10T12:00:00.000Z');
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
      now: () => now++,
    });

    for (let index = 0; index < 101; index += 1) {
      buffer.recordScreen(index % 2 === 0 ? 'PARENT_HOME' : 'PARENT_CHORES');
    }
    const countLimited = buffer.snapshot().events;
    expect(countLimited).toHaveLength(100);
    expect(countLimited[0]).toMatchObject({ screen: 'PARENT_CHORES' });

    for (let index = 0; index < 100; index += 1) {
      buffer.recordApiResult({
        operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW',
        outcome: 'ERROR',
        status: 599,
        errorCode: 'UNSUPPORTED_MEDIA_TYPE',
        durationBucket: 'FIVE_SECONDS_OR_MORE',
        requestId,
      });
    }
    const byteLimited = buffer.snapshot().events;
    expect(byteLimited.length).toBeLessThan(100);
    expect(
      new TextEncoder().encode(JSON.stringify(byteLimited)).byteLength,
    ).toBeLessThanOrEqual(24 * 1_024);
  });

  it('records only a templated API result from fetch failures', async () => {
    let now = Date.parse('2026-08-10T12:00:00.000Z');
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
      now: () => now,
    });
    const fetch = vi.fn(async () => {
      now += 300;
      return new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: 'Do not retain this raw error.',
          requestId,
          requestBody: 'never retain',
        }),
        { status: 422, headers: { authorization: 'Bearer never-retain' } },
      );
    });

    const diagnosticFetch = createDiagnosticFetch(fetch, buffer, () => now);
    await diagnosticFetch(
      'https://api.family.test/v1/feedback?token=never-retain',
      {
        method: 'POST',
        headers: { authorization: 'Bearer never-retain' },
        body: JSON.stringify({ description: 'never retain' }),
      },
    );

    expect(buffer.snapshot().events).toEqual([
      expect.objectContaining({
        kind: 'API_RESULT',
        operation: 'CREATE_FEEDBACK',
        outcome: 'ERROR',
        status: 422,
        errorCode: 'VALIDATION_ERROR',
        durationBucket: 'UNDER_1_SECOND',
        requestId,
      }),
    ]);
    const stored = JSON.stringify(buffer.snapshot());
    expect(stored).not.toContain('token=');
    expect(stored).not.toContain('never retain');
    expect(stored).not.toContain('authorization');
  });

  it.each([
    {
      outcome: 'success',
      settle: (request: Deferred<Response>) =>
        request.resolve(Response.json({ ok: true })),
    },
    {
      outcome: 'contracted error',
      settle: (request: Deferred<Response>) =>
        request.resolve(
          Response.json(
            {
              code: 'INTERNAL_ERROR',
              message: 'Family A failed.',
              requestId,
            },
            { status: 503 },
          ),
        ),
    },
  ])(
    'drops a late $outcome result when its diagnostic scope was reset',
    async ({ settle }) => {
      // Break caught: a family A request resolves after reset and appends its result to family B's empty buffer.
      const buffer = createDiagnosticBuffer({
        source: 'PARENT_IOS',
        appVersion: '0.1.0',
      });
      const request = deferred<Response>();
      const diagnosticFetch = createDiagnosticFetch(
        vi.fn(() => request.promise),
        buffer,
      );

      const pending = diagnosticFetch(
        'https://api.family.test/v1/feedback/44444444-4444-4444-8444-444444444444',
      );
      buffer.reset('PARENT_HOME');
      settle(request);
      await pending;

      expect(buffer.snapshot()).toEqual({
        source: 'PARENT_IOS',
        appVersion: '0.1.0',
        currentScreen: 'PARENT_HOME',
        events: [],
      });
    },
  );

  it('drops a late thrown request result when its diagnostic scope was reset', async () => {
    // Break caught: a rejected family A request appends an API_RESULT with null status after family B takes over.
    const buffer = createDiagnosticBuffer({
      source: 'PARENT_IOS',
      appVersion: '0.1.0',
    });
    const request = deferred<Response>();
    const diagnosticFetch = createDiagnosticFetch(
      vi.fn(() => request.promise),
      buffer,
    );

    const pending = diagnosticFetch(
      'https://api.family.test/v1/feedback/44444444-4444-4444-8444-444444444444',
    );
    buffer.reset('PARENT_HOME');
    request.reject(new TypeError('family A connection closed'));

    await expect(pending).rejects.toThrow('family A connection closed');
    expect(buffer.snapshot().events).toEqual([]);
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
