import {
  ApiErrorSchema,
  ClientDiagnosticSnapshotSchema,
  DIAGNOSTIC_WINDOW_MS,
  FeedbackConnectionStateSchema,
  FeedbackDiagnosticEventSchema,
  FeedbackScreenSchema,
  FeedbackSourceSchema,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_EVENTS,
  type ApiErrorCode,
  type ClientDiagnosticSnapshot,
  type FeedbackApiOperation,
  type FeedbackConnectionState,
  type FeedbackDiagnosticEvent,
  type FeedbackDurationBucket,
  type FeedbackScreen,
  type FeedbackSource,
} from '@family/contracts';

export interface DiagnosticBuffer {
  captureEpoch(): number;
  reset(initialScreen?: FeedbackScreen): void;
  recordScreen(screen: FeedbackScreen): void;
  recordNetwork(state: FeedbackConnectionState): void;
  recordApiResult(
    input: {
      operation: FeedbackApiOperation;
      outcome: 'SUCCESS' | 'ERROR';
      status: number | null;
      errorCode: ApiErrorCode | null;
      durationBucket: FeedbackDurationBucket;
      requestId: string | null;
    },
    expectedEpoch?: number,
  ): boolean;
  snapshot(): ClientDiagnosticSnapshot;
}

export interface DiagnosticBufferOptions {
  source: FeedbackSource;
  appVersion: string;
  now?: () => number;
}

export function createDiagnosticBuffer(
  options: DiagnosticBufferOptions,
): DiagnosticBuffer {
  const now = options.now ?? Date.now;
  const source = FeedbackSourceSchema.parse(options.source);
  let currentScreen: FeedbackScreen = 'SETUP';
  let events: FeedbackDiagnosticEvent[] = [];
  let epoch = 0;

  function append(event: FeedbackDiagnosticEvent): void {
    events.push(event);
    prune();
  }

  function prune(): void {
    const earliest = now() - DIAGNOSTIC_WINDOW_MS;
    events = events.filter((event) => Date.parse(event.at) >= earliest);
    while (
      events.length > MAX_DIAGNOSTIC_EVENTS ||
      encodedEventBytes(events) > MAX_DIAGNOSTIC_BYTES
    ) {
      events.shift();
    }
  }

  return {
    captureEpoch() {
      return epoch;
    },
    reset(initialScreen = 'SETUP') {
      const validatedScreen = FeedbackScreenSchema.parse(initialScreen);
      epoch += 1;
      currentScreen = validatedScreen;
      events = [];
    },
    recordScreen(screen) {
      currentScreen = FeedbackScreenSchema.parse(screen);
      append(
        FeedbackDiagnosticEventSchema.parse({
          kind: 'SCREEN',
          at: timestamp(now()),
          screen: currentScreen,
        }),
      );
    },
    recordNetwork(state) {
      append(
        FeedbackDiagnosticEventSchema.parse({
          kind: 'NETWORK',
          at: timestamp(now()),
          state: FeedbackConnectionStateSchema.parse(state),
        }),
      );
    },
    recordApiResult(input, expectedEpoch) {
      if (expectedEpoch !== undefined && expectedEpoch !== epoch) return false;
      append(
        FeedbackDiagnosticEventSchema.parse({
          kind: 'API_RESULT',
          at: timestamp(now()),
          ...input,
        }),
      );
      return true;
    },
    snapshot() {
      prune();
      return ClientDiagnosticSnapshotSchema.parse({
        source,
        appVersion: options.appVersion,
        currentScreen,
        events: events.map((event) => ({ ...event })),
      });
    },
  };
}

export function createDiagnosticFetch(
  fetchImpl: typeof globalThis.fetch,
  buffer: DiagnosticBuffer,
  now: () => number = Date.now,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = requestMetadata(input, init);
    const operation = request
      ? operationForRequest(request.method, request.url.pathname)
      : undefined;
    const startedAt = now();
    const epoch = buffer.captureEpoch();

    try {
      const response = await fetchImpl(input, init);
      if (operation) {
        const error = response.ok ? undefined : await contractedError(response);
        buffer.recordApiResult(
          {
            operation,
            outcome: response.ok ? 'SUCCESS' : 'ERROR',
            status: response.status,
            errorCode: error?.code ?? null,
            durationBucket: durationBucket(now() - startedAt),
            requestId: error?.requestId ?? null,
          },
          epoch,
        );
      }
      return response;
    } catch (error) {
      if (operation) {
        buffer.recordApiResult(
          {
            operation,
            outcome: 'ERROR',
            status: null,
            errorCode: null,
            durationBucket: durationBucket(now() - startedAt),
            requestId: null,
          },
          epoch,
        );
      }
      throw error;
    }
  };
}

function requestMetadata(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { method: string; url: URL } | undefined {
  try {
    const request = new Request(input, init);
    return { method: request.method, url: new URL(request.url) };
  } catch {
    return undefined;
  }
}

async function contractedError(
  response: Response,
): Promise<{ code: ApiErrorCode; requestId: string } | undefined> {
  try {
    const payload: unknown = await response.clone().json();
    const parsed = ApiErrorSchema.safeParse(payload);
    return parsed.success
      ? { code: parsed.data.code, requestId: parsed.data.requestId }
      : undefined;
  } catch {
    return undefined;
  }
}

function operationForRequest(
  method: string,
  pathname: string,
): FeedbackApiOperation | undefined {
  const matchers: ReadonlyArray<
    readonly [string, RegExp, FeedbackApiOperation]
  > = [
    ['GET', /^\/v1\/parent\/snapshot$/, 'GET_PARENT_SNAPSHOT'],
    ['GET', /^\/v1\/dashboard\/snapshot$/, 'GET_DASHBOARD_SNAPSHOT'],
    ['POST', /^\/v1\/households$/, 'CREATE_HOUSEHOLD'],
    ['POST', /^\/v1\/children$/, 'CREATE_CHILD'],
    ['GET', /^\/v1\/children\/[^/]+\/ledger$/, 'GET_CHILD_LEDGER'],
    ['GET', /^\/v1\/children\/[^/]+\/balance$/, 'GET_CHILD_BALANCE'],
    ['POST', /^\/v1\/children\/[^/]+\/ledger$/, 'RECORD_MANUAL_LEDGER_ENTRY'],
    ['POST', /^\/v1\/chore-templates$/, 'CREATE_CHORE_TEMPLATE'],
    ['POST', /^\/v1\/chore-instances$/, 'PUBLISH_CHORE_INSTANCE'],
    ['GET', /^\/v1\/chore-instances$/, 'LIST_CHORE_INSTANCES'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/claim$/, 'CLAIM_CHORE'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/submit$/, 'SUBMIT_CHORE'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/extend$/, 'EXTEND_CHORE_CLAIM'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/cancel$/, 'CANCEL_CHORE_CLAIM'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/approve$/, 'APPROVE_CHORE'],
    ['POST', /^\/v1\/chore-instances\/[^/]+\/reject$/, 'REJECT_CHORE'],
    ['POST', /^\/v1\/feedback$/, 'CREATE_FEEDBACK'],
    ['GET', /^\/v1\/feedback$/, 'LIST_FEEDBACK'],
    ['GET', /^\/v1\/feedback\/[^/]+$/, 'GET_FEEDBACK'],
    ['PATCH', /^\/v1\/feedback\/[^/]+$/, 'UPDATE_FEEDBACK'],
    ['DELETE', /^\/v1\/feedback\/[^/]+$/, 'DELETE_FEEDBACK'],
    [
      'POST',
      /^\/v1\/feedback\/[^/]+\/public-preview$/,
      'CREATE_FEEDBACK_PUBLIC_PREVIEW',
    ],
  ];
  return matchers.find(
    ([expectedMethod, pattern]) =>
      expectedMethod === method && pattern.test(pathname),
  )?.[2];
}

function durationBucket(durationMs: number): FeedbackDurationBucket {
  if (durationMs < 250) return 'UNDER_250_MS';
  if (durationMs < 1_000) return 'UNDER_1_SECOND';
  if (durationMs < 5_000) return 'UNDER_5_SECONDS';
  return 'FIVE_SECONDS_OR_MORE';
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}

function encodedEventBytes(events: readonly FeedbackDiagnosticEvent[]): number {
  return new TextEncoder().encode(JSON.stringify(events)).byteLength;
}
