import { describe, expect, it } from 'vitest';

import { createFamilyApiClient, type FamilyApiClient } from '../src/index.js';

const feedbackId = '11111111-1111-4111-8111-111111111111';
const idempotencyKey = '22222222-2222-4222-8222-222222222222';
const updatedIdempotencyKey = '33333333-3333-4333-8333-333333333333';
const deletedIdempotencyKey = '44444444-4444-4444-8444-444444444444';
const createdAt = '2026-08-10T12:00:00.000Z';
const updatedAt = '2026-08-10T12:01:00.000Z';

const diagnosticSnapshot = {
  source: 'PARENT_IOS' as const,
  appVersion: '1.2.3',
  currentScreen: 'PARENT_FEEDBACK' as const,
  events: [],
};

const listItem = {
  id: feedbackId,
  category: 'BROKEN' as const,
  source: 'PARENT_IOS' as const,
  appVersion: '1.2.3',
  screen: 'PARENT_FEEDBACK' as const,
  status: 'NEW' as const,
  createdAt,
  updatedAt,
  descriptionPreview: 'Feedback body',
  hasDiagnostics: true,
};

const report = {
  id: feedbackId,
  category: 'BROKEN' as const,
  source: 'PARENT_IOS' as const,
  appVersion: '1.2.3',
  screen: 'PARENT_FEEDBACK' as const,
  status: 'NEW' as const,
  createdAt,
  updatedAt,
  title: 'Feedback title',
  description: 'Feedback body',
  diagnosticSnapshot,
  privacyFindings: [],
  publicIssueUrl: null,
  reviewedAt: null,
  exportedAt: null,
  closedAt: null,
};

const publicPreview = {
  repositoryUrl: 'https://github.com/family-tests/family-app',
  title: 'Public feedback title',
  body: 'Public feedback body',
  labels: ['feedback', 'type:bug'],
  redactions: [],
};

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

describe('feedback client', () => {
  it('sends feedback state mutations with idempotency in the header only', async () => {
    // Break caught: mutation routes, methods, or idempotency serialization diverge from the API contract.
    const { client, requests } = clientWith([
      Response.json({ id: feedbackId, status: 'NEW', createdAt }),
      Response.json(report),
      Response.json({ id: feedbackId, deleted: true }),
    ]);

    await client.createFeedback({
      idempotencyKey,
      category: 'BROKEN',
      description: '  Feedback body  ',
      diagnosticSnapshot,
    });
    await client.updateFeedback(feedbackId, {
      idempotencyKey: updatedIdempotencyKey,
      expectedUpdatedAt: updatedAt,
      title: '  Feedback title  ',
      status: 'REVIEWING',
    });
    await client.deleteFeedback(feedbackId, {
      idempotencyKey: deletedIdempotencyKey,
    });

    expect(requests).toHaveLength(3);
    const [created, updated, deleted] = requests;
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe(
        'Bearer signed.fixture',
      );
      expect(request.headers.get('accept')).toBe('application/json');
    }
    expect({
      method: created!.method,
      pathname: new URL(created!.url).pathname,
      idempotencyKey: created!.headers.get('idempotency-key'),
      body: await created!.json(),
    }).toEqual({
      method: 'POST',
      pathname: '/v1/feedback',
      idempotencyKey,
      body: {
        category: 'BROKEN',
        description: 'Feedback body',
        diagnosticSnapshot,
      },
    });
    expect({
      method: updated!.method,
      pathname: new URL(updated!.url).pathname,
      idempotencyKey: updated!.headers.get('idempotency-key'),
      body: await updated!.json(),
    }).toEqual({
      method: 'PATCH',
      pathname: `/v1/feedback/${feedbackId}`,
      idempotencyKey: updatedIdempotencyKey,
      body: {
        expectedUpdatedAt: updatedAt,
        title: 'Feedback title',
        status: 'REVIEWING',
      },
    });
    expect({
      method: deleted!.method,
      pathname: new URL(deleted!.url).pathname,
      idempotencyKey: deleted!.headers.get('idempotency-key'),
      body: await deleted!.json(),
    }).toEqual({
      method: 'DELETE',
      pathname: `/v1/feedback/${feedbackId}`,
      idempotencyKey: deletedIdempotencyKey,
      body: {},
    });
  });

  it('uses contracted read routes and parses their responses', async () => {
    // Break caught: parent feedback reads use the wrong route or return unchecked payloads.
    const { client, requests } = clientWith([
      Response.json([listItem]),
      Response.json(report),
      Response.json(publicPreview),
    ]);

    await expect(client.listFeedback()).resolves.toEqual([listItem]);
    await expect(client.getFeedback(feedbackId)).resolves.toEqual(report);
    await expect(
      client.prepareFeedbackPublicPreview(feedbackId, {
        publicTitle: '  Public feedback title  ',
        publicDescription: '  Public feedback body  ',
        includeDiagnostics: true,
      }),
    ).resolves.toEqual(publicPreview);

    expect(requests).toHaveLength(3);
    expect(
      requests.map((request) => ({
        method: request.method,
        pathname: new URL(request.url).pathname,
        idempotencyKey: request.headers.get('idempotency-key'),
        authorization: request.headers.get('authorization'),
      })),
    ).toEqual([
      {
        method: 'GET',
        pathname: '/v1/feedback',
        idempotencyKey: null,
        authorization: 'Bearer signed.fixture',
      },
      {
        method: 'GET',
        pathname: `/v1/feedback/${feedbackId}`,
        idempotencyKey: null,
        authorization: 'Bearer signed.fixture',
      },
      {
        method: 'POST',
        pathname: `/v1/feedback/${feedbackId}/public-preview`,
        idempotencyKey: null,
        authorization: 'Bearer signed.fixture',
      },
    ]);
    expect(await requests[2]!.json()).toEqual({
      publicTitle: 'Public feedback title',
      publicDescription: 'Public feedback body',
      includeDiagnostics: true,
    });
  });

  it.each([
    {
      name: 'create unknown private field',
      invoke: async (client: FamilyApiClient) =>
        client.createFeedback({
          idempotencyKey,
          category: 'BROKEN',
          description: 'Feedback body',
          diagnosticSnapshot,
          privateDescription: 'must never leave the client',
        } as never),
    },
    {
      name: 'create invalid category enum',
      invoke: async (client: FamilyApiClient) =>
        client.createFeedback({
          idempotencyKey,
          category: 'OTHER',
          description: 'Feedback body',
          diagnosticSnapshot,
        } as never),
    },
    {
      name: 'create oversized description',
      invoke: async (client: FamilyApiClient) =>
        client.createFeedback({
          idempotencyKey,
          category: 'BROKEN',
          description: 'x'.repeat(2_001),
          diagnosticSnapshot,
        } as never),
    },
    {
      name: 'create invalid diagnostics',
      invoke: async (client: FamilyApiClient) =>
        client.createFeedback({
          idempotencyKey,
          category: 'BROKEN',
          description: 'Feedback body',
          diagnosticSnapshot: {
            ...diagnosticSnapshot,
            currentScreen: 'PRIVATE_SCREEN',
          },
        } as never),
    },
    {
      name: 'update unknown private field',
      invoke: async (client: FamilyApiClient) =>
        client.updateFeedback(feedbackId, {
          idempotencyKey,
          expectedUpdatedAt: updatedAt,
          title: 'Feedback title',
          privateNotes: 'must never leave the client',
        } as never),
    },
    {
      name: 'update invalid status enum',
      invoke: async (client: FamilyApiClient) =>
        client.updateFeedback(feedbackId, {
          idempotencyKey,
          expectedUpdatedAt: updatedAt,
          status: 'PENDING',
        } as never),
    },
    {
      name: 'update noncanonical nanosecond revision',
      invoke: async (client: FamilyApiClient) =>
        client.updateFeedback(feedbackId, {
          idempotencyKey,
          expectedUpdatedAt: '2026-08-10T12:00:00.000000001Z',
          title: 'Feedback title',
        }),
    },
    {
      name: 'delete unknown private field',
      invoke: async (client: FamilyApiClient) =>
        client.deleteFeedback(feedbackId, {
          idempotencyKey,
          privateNotes: 'must never leave the client',
        } as never),
    },
    {
      name: 'preview unknown private field',
      invoke: async (client: FamilyApiClient) =>
        client.prepareFeedbackPublicPreview(feedbackId, {
          publicTitle: 'Public feedback title',
          publicDescription: 'Public feedback body',
          includeDiagnostics: false,
          privateDescription: 'must never leave the client',
        } as never),
    },
    {
      name: 'list unknown query field',
      invoke: async (client: FamilyApiClient) =>
        (client.listFeedback as (query: unknown) => Promise<unknown>)({
          privateSearch: 'must never enter the URL',
        }),
    },
    {
      name: 'detail UUID with path delimiters',
      invoke: async (client: FamilyApiClient) =>
        client.getFeedback(`${feedbackId}/public-preview?private=1`),
    },
    {
      name: 'update malformed UUID',
      invoke: async (client: FamilyApiClient) =>
        client.updateFeedback('not-a-uuid', {
          idempotencyKey,
          expectedUpdatedAt: updatedAt,
          title: 'Feedback title',
        }),
    },
    {
      name: 'delete UUID with query delimiter',
      invoke: async (client: FamilyApiClient) =>
        client.deleteFeedback(`${feedbackId}?private=1`, { idempotencyKey }),
    },
    {
      name: 'preview UUID with fragment delimiter',
      invoke: async (client: FamilyApiClient) =>
        client.prepareFeedbackPublicPreview(`${feedbackId}#private`, {
          publicTitle: 'Public feedback title',
          publicDescription: 'Public feedback body',
          includeDiagnostics: false,
        }),
    },
  ])('rejects $name before transport', async ({ invoke }) => {
    // Break caught: invalid or private caller data reaches fetch before the Task 1 boundary rejects it.
    const { client, requests } = clientWith([]);

    await expect(invoke(client)).rejects.toHaveProperty('name', 'ZodError');
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      'list',
      (client: ReturnType<typeof createFamilyApiClient>) =>
        client.listFeedback(),
    ],
    [
      'detail',
      (client: ReturnType<typeof createFamilyApiClient>) =>
        client.getFeedback(feedbackId),
    ],
    [
      'public preview',
      (client: ReturnType<typeof createFamilyApiClient>) =>
        client.prepareFeedbackPublicPreview(feedbackId, {
          publicTitle: 'Public feedback title',
          publicDescription: 'Public feedback body',
          includeDiagnostics: false,
        }),
    ],
  ])(
    'fails closed when the feedback %s response is malformed',
    async (_, invoke) => {
      // Break caught: malformed API data crosses the shared client boundary as trusted feedback data.
      const { client } = clientWith([Response.json({ unexpected: true })]);

      await expect(invoke(client)).rejects.toMatchObject({
        kind: 'UNEXPECTED',
      });
    },
  );

  it('preserves rate-limit guidance as a structured API error without retrying', async () => {
    // Break caught: dashboard feedback admission limits are hidden as offline failures or retried automatically.
    const { client, requests } = clientWith([
      Response.json(
        {
          code: 'RATE_LIMITED',
          message: 'Please wait before submitting another report.',
          requestId: '55555555-5555-4555-8555-555555555555',
        },
        { status: 429 },
      ),
    ]);

    await expect(
      client.createFeedback({
        idempotencyKey,
        category: 'BROKEN',
        description: 'Feedback body',
        diagnosticSnapshot,
      }),
    ).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      code: 'RATE_LIMITED',
      message: 'Please wait before submitting another report.',
      requestId: '55555555-5555-4555-8555-555555555555',
    });
    expect(requests).toHaveLength(1);
  });
});
