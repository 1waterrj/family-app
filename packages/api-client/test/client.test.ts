import { describe, expect, it, vi } from 'vitest';

import {
  createFamilyApiClient,
  FamilyApiError,
  type FamilyApiClient,
} from '../src/index.js';

const householdId = '22222222-2222-4222-8222-222222222222';
const childId = '33333333-3333-4333-8333-333333333333';
const choreInstanceId = '44444444-4444-4444-8444-444444444444';
const choreTemplateId = '55555555-5555-4555-8555-555555555555';
const operationKey = '66666666-6666-4666-8666-666666666666';
const submissionAttemptId = '77777777-7777-4777-8777-777777777777';
const decisionId = '88888888-8888-4888-8888-888888888888';
const ledgerTransactionId = '99999999-9999-4999-8999-999999999999';
const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const createdAt = '2026-08-09T12:00:00.000Z';

function validChoreInstance() {
  return {
    id: choreInstanceId,
    householdId,
    choreTemplateId,
    name: 'Tidy toys',
    imageKey: 'tidy-toys',
    imageUrl: null,
    instructions: 'Put toys into bins.',
    valueCents: 250,
    durationMinutes: 15,
    status: 'CLAIMED',
    claimedChildId: childId,
    claimDeadlineAt: '2026-08-09T12:15:00.000Z',
    submittedAt: null,
    createdAt,
  };
}

function validChoreTemplate() {
  return {
    id: choreTemplateId,
    householdId,
    name: 'Tidy toys',
    imageKey: 'tidy-toys',
    imageUrl: null,
    instructions: 'Put toys into bins.',
    defaultValueCents: 250,
    defaultDurationMinutes: 15,
    isActive: true,
    createdAt,
  };
}

function validParentSnapshot() {
  return {
    household: {
      id: householdId,
      name: 'Fixture family',
      timeZone: 'America/New_York',
      createdAt,
    },
    serverTime: createdAt,
    children: [],
    templates: [],
    chores: [],
    pendingApprovals: [],
  };
}

function validDashboardSnapshot() {
  return {
    household: {
      id: householdId,
      name: 'Fixture family',
      timeZone: 'America/New_York',
    },
    serverTime: createdAt,
    children: [],
    chores: [],
  };
}

function validLedgerTransaction() {
  return {
    id: ledgerTransactionId,
    householdId,
    childId,
    amountCents: -125,
    type: 'PURCHASE',
    note: 'Book',
    actorParentId: parentId,
    relatedChoreInstanceId: null,
    approvalDecisionId: null,
    createdAt,
  };
}

const apiCallCases: ReadonlyArray<{
  name: string;
  invoke: (client: FamilyApiClient) => Promise<unknown>;
  response: () => unknown;
  url: string;
  method: string;
  body?: unknown;
  idempotencyKey?: string;
}> = [
  {
    name: 'getParentSnapshot',
    invoke: (client) => client.getParentSnapshot(),
    response: validParentSnapshot,
    url: 'https://api.fixture.test/v1/parent/snapshot',
    method: 'GET',
  },
  {
    name: 'getDashboardSnapshot',
    invoke: (client) => client.getDashboardSnapshot(),
    response: validDashboardSnapshot,
    url: 'https://api.fixture.test/v1/dashboard/snapshot',
    method: 'GET',
  },
  {
    name: 'createTemplate',
    invoke: (client) =>
      client.createTemplate({
        householdId,
        name: 'Wash dishes',
        imageKey: 'dishes',
        imageUrl: 'https://images.fixture.test/dishes.png',
        instructions: 'Use soap and rinse.',
        defaultValueCents: 375,
        defaultDurationMinutes: 25,
        idempotencyKey: operationKey,
      }),
    response: validChoreTemplate,
    url: 'https://api.fixture.test/v1/chore-templates',
    method: 'POST',
    body: {
      householdId,
      name: 'Wash dishes',
      imageKey: 'dishes',
      imageUrl: 'https://images.fixture.test/dishes.png',
      instructions: 'Use soap and rinse.',
      defaultValueCents: 375,
      defaultDurationMinutes: 25,
    },
    idempotencyKey: operationKey,
  },
  {
    name: 'publishChore',
    invoke: (client) =>
      client.publishChore({
        householdId,
        choreTemplateId,
        valueCents: 375,
        instructions: 'Use soap and rinse.',
        durationMinutes: 25,
        idempotencyKey: operationKey,
      }),
    response: validChoreInstance,
    url: 'https://api.fixture.test/v1/chore-instances',
    method: 'POST',
    body: {
      householdId,
      choreTemplateId,
      valueCents: 375,
      instructions: 'Use soap and rinse.',
      durationMinutes: 25,
    },
    idempotencyKey: operationKey,
  },
  {
    name: 'claimChore',
    invoke: (client) =>
      client.claimChore({
        choreInstanceId,
        childId,
        idempotencyKey: operationKey,
      }),
    response: validChoreInstance,
    url: `https://api.fixture.test/v1/chore-instances/${choreInstanceId}/claim`,
    method: 'POST',
    body: { childId },
    idempotencyKey: operationKey,
  },
  {
    name: 'submitChore',
    invoke: (client) =>
      client.submitChore({
        choreInstanceId,
        childId,
        idempotencyKey: operationKey,
      }),
    response: () => ({ ...validChoreInstance(), submissionAttemptId }),
    url: `https://api.fixture.test/v1/chore-instances/${choreInstanceId}/submit`,
    method: 'POST',
    body: { childId },
    idempotencyKey: operationKey,
  },
  {
    name: 'approveChore',
    invoke: (client) =>
      client.approveChore({
        choreInstanceId,
        submissionAttemptId,
        payoutCents: 275,
        note: 'Nice work.',
        idempotencyKey: operationKey,
      }),
    response: () => ({
      decisionId,
      submissionAttemptId,
      decision: 'APPROVED',
      payoutCents: 275,
      note: 'Nice work.',
      choreInstance: validChoreInstance(),
    }),
    url: `https://api.fixture.test/v1/chore-instances/${choreInstanceId}/approve`,
    method: 'POST',
    body: { submissionAttemptId, payoutCents: 275, note: 'Nice work.' },
    idempotencyKey: operationKey,
  },
  {
    name: 'rejectChore',
    invoke: (client) =>
      client.rejectChore({
        choreInstanceId,
        submissionAttemptId,
        retry: true,
        reason: 'Please try again.',
        idempotencyKey: operationKey,
      }),
    response: () => ({
      decisionId,
      submissionAttemptId,
      decision: 'REJECTED',
      payoutCents: null,
      note: 'Please try again.',
      choreInstance: validChoreInstance(),
    }),
    url: `https://api.fixture.test/v1/chore-instances/${choreInstanceId}/reject`,
    method: 'POST',
    body: {
      submissionAttemptId,
      retry: true,
      reason: 'Please try again.',
    },
    idempotencyKey: operationKey,
  },
  {
    name: 'getLedger',
    invoke: (client) => client.getLedger(childId),
    response: () => ({
      householdId,
      childId,
      balanceCents: 250,
      transactions: [],
    }),
    url: `https://api.fixture.test/v1/children/${childId}/ledger`,
    method: 'GET',
  },
  {
    name: 'recordLedgerEntry',
    invoke: (client) =>
      client.recordLedgerEntry({
        householdId,
        childId,
        amountCents: -125,
        type: 'PURCHASE',
        note: 'Book',
        idempotencyKey: operationKey,
      }),
    response: validLedgerTransaction,
    url: `https://api.fixture.test/v1/children/${childId}/ledger`,
    method: 'POST',
    body: { householdId, amountCents: -125, type: 'PURCHASE', note: 'Book' },
    idempotencyKey: operationKey,
  },
];

function recordingFetch(responses: Response[]) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (!response) throw new Error('No response configured');
    return response;
  };
  return { fetch, requests };
}

function clientWith(responses: Response[]) {
  const fake = recordingFetch(responses);
  return {
    ...fake,
    client: createFamilyApiClient({
      apiOrigin: 'https://api.fixture.test',
      accessToken: 'signed.fixture',
      fetch: fake.fetch,
    }),
  };
}

describe('FamilyApiClient', () => {
  it.each(apiCallCases)(
    '$name sends the contracted request without placing idempotency in JSON',
    async ({ invoke, response, url, method, body, idempotencyKey }) => {
      const { client, requests } = clientWith([Response.json(response())]);

      await invoke(client);

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request.url).toBe(url);
      expect(request.method).toBe(method);
      expect(request.headers.get('accept')).toBe('application/json');
      expect(request.headers.get('authorization')).toBe(
        'Bearer signed.fixture',
      );
      expect(request.headers.get('idempotency-key')).toBe(
        idempotencyKey ?? null,
      );
      expect(request.headers.get('content-type')).toBe(
        body === undefined ? null : 'application/json',
      );
      if (body === undefined) {
        expect(request.body).toBeNull();
      } else {
        expect(await request.json()).toEqual(body);
      }
    },
  );

  it.each(apiCallCases)(
    '$name rejects a schema-invalid success response',
    async ({ invoke }) => {
      const { client } = clientWith([Response.json({ unexpected: true })]);

      await expect(invoke(client)).rejects.toMatchObject({
        kind: 'UNEXPECTED',
      });
    },
  );

  it('sends retry idempotency keys only as headers', async () => {
    const { client, requests } = clientWith([
      Response.json(validChoreInstance()),
      Response.json(validChoreInstance()),
    ]);

    await client.claimChore({
      choreInstanceId,
      childId,
      idempotencyKey: operationKey,
    });
    await client.claimChore({
      choreInstanceId,
      childId,
      idempotencyKey: operationKey,
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe(
        `https://api.fixture.test/v1/chore-instances/${choreInstanceId}/claim`,
      );
      expect(request.headers.get('authorization')).toBe(
        'Bearer signed.fixture',
      );
      expect(request.headers.get('idempotency-key')).toBe(operationKey);
      expect(await request.json()).toEqual({ childId });
    }
  });

  it('preserves contracted field errors and request IDs without retaining bodies', async () => {
    const { client } = clientWith([
      Response.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          requestId: '77777777-7777-4777-8777-777777777777',
          fieldErrors: { 'body.childId': ['Expected UUID'] },
          privateDiagnostic: 'must-not-be-exposed',
        },
        { status: 400 },
      ),
    ]);

    const result = client.getLedger(childId);
    await expect(result).rejects.toMatchObject({
      kind: 'VALIDATION',
      message: 'The request is invalid.',
      requestId: '77777777-7777-4777-8777-777777777777',
      fieldErrors: { 'body.childId': ['Expected UUID'] },
    });
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(FamilyApiError);
      expect(error).not.toHaveProperty('body');
      expect(error).not.toHaveProperty('privateDiagnostic');
    });
  });

  it('preserves the contracted error code independently from its human message', async () => {
    const { client } = clientWith([
      Response.json(
        {
          code: 'CHORE_UNAVAILABLE',
          message: 'Another helper got there first.',
          requestId: '77777777-7777-4777-8777-777777777777',
        },
        { status: 409 },
      ),
    ]);

    await expect(
      client.claimChore({
        choreInstanceId,
        childId,
        idempotencyKey: operationKey,
      }),
    ).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'CHORE_UNAVAILABLE',
      message: 'Another helper got there first.',
    });
  });

  it('normalizes unavailable, offline, and malformed success responses', async () => {
    const unavailable = clientWith([
      Response.json({ message: 'Maintenance' }, { status: 503 }),
    ]);
    await expect(unavailable.client.getLedger(childId)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });

    const unavailableWithText = clientWith([
      new Response('temporarily unavailable', { status: 503 }),
    ]);
    await expect(
      unavailableWithText.client.getLedger(childId),
    ).rejects.toMatchObject({ kind: 'UNAVAILABLE' });

    const offline = createFamilyApiClient({
      apiOrigin: 'https://api.fixture.test',
      accessToken: 'signed.fixture',
      fetch: async () => {
        throw new TypeError('network down');
      },
    });
    await expect(offline.getLedger(childId)).rejects.toMatchObject({
      kind: 'OFFLINE',
    });

    const malformed = clientWith([Response.json({ unexpected: true })]);
    await expect(malformed.client.getLedger(childId)).rejects.toMatchObject({
      kind: 'UNEXPECTED',
    });
  });

  it('does not normalize an AbortError into an offline failure', async () => {
    const abort = new DOMException('Cancelled by user', 'AbortError');
    const client = createFamilyApiClient({
      apiOrigin: 'https://api.fixture.test',
      accessToken: 'signed.fixture',
      fetch: async () => {
        throw abort;
      },
    });

    await expect(client.getLedger(childId)).rejects.toBe(abort);
  });

  it('preserves AbortErrors supplied by non-browser fetch implementations', async () => {
    const abort = { name: 'AbortError' };
    const client = createFamilyApiClient({
      apiOrigin: 'https://api.fixture.test',
      accessToken: 'signed.fixture',
      fetch: async () => {
        throw abort;
      },
    });

    await expect(client.getLedger(childId)).rejects.toBe(abort);
  });

  it('does not normalize an AbortError raised while parsing a response body', async () => {
    const abort = new DOMException('Cancelled by user', 'AbortError');
    const { client } = clientWith([
      {
        ok: true,
        status: 200,
        json: async () => {
          throw abort;
        },
      } as Response,
    ]);

    await expect(client.getLedger(childId)).rejects.toBe(abort);
  });

  it('aborts and settles a request that exceeds its deadline', async () => {
    // Break caught: a fetch that never settles holds the feedback drain and every later queued draft forever.
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const client = createFamilyApiClient({
        apiOrigin: 'https://api.fixture.test',
        accessToken: 'signed.fixture',
        requestTimeoutMs: 1_000,
        fetch: async (_input, init) => {
          signal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        },
      });
      let outcome = 'pending';
      void client.getParentSnapshot().catch((error: unknown) => {
        outcome = error instanceof FamilyApiError ? error.kind : 'unexpected';
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(signal?.aborted).toBe(true);
      expect(outcome).toBe('OFFLINE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels every pending request even when fetch ignores abort', async () => {
    // Break caught: scope reset or unmount only cancels retry timers while the production transport remains alive.
    const client = createFamilyApiClient({
      apiOrigin: 'https://api.fixture.test',
      accessToken: 'signed.fixture',
      fetch: async () => new Promise<Response>(() => undefined),
    });

    const pending = client.getParentSnapshot();
    expect(typeof client.cancelPendingRequests).toBe('function');
    client.cancelPendingRequests();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
