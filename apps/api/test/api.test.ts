import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  ChildProfileSchema,
  ChoreDecisionResultSchema,
  ChoreInstanceSchema,
  ChoreSubmissionResultSchema,
  ChoreTemplateSchema,
  DashboardSnapshotSchema,
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  FeedbackSubmissionReceiptSchema,
  HealthStatusSchema,
  HouseholdSchema,
  LedgerBalanceSchema,
  LedgerSummarySchema,
  LedgerTransactionSchema,
  ParentSnapshotSchema,
} from '@family/contracts';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  DevelopmentActorAuthenticator,
  issueDevelopmentActorToken,
  type ActorContext,
} from '../src/auth/actor-context.js';
import { choreTemplates, dashboardDevices } from '../src/db/schema.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

const developmentAuthSecret =
  'test-only-development-auth-secret-with-at-least-32-characters';

describe('HTTP API contract', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    app = buildApp({
      database: testDatabase.database,
      nodeEnv: 'test',
      developmentAuthSecret,
      feedbackGithubRepository: 'https://github.com/family-tests/family-app',
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase?.stop();
  });

  it('returns 401 without an actor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/chore-instances?status=AVAILABLE',
    });

    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects plain actor and household headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/chore-instances?status=AVAILABLE',
      headers: {
        'x-actor-id': randomUUID(),
        'x-actor-role': 'PARENT',
        'x-household-id': randomUUID(),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('returns 403 when a dashboard calls a parent route', async () => {
    const { dashboard, household } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: mutationHeaders(dashboard),
      payload: {
        householdId: household.id,
        name: 'Not allowed',
        color: 'blue',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('exposes a strict parent-only scrubbed feedback preview without an idempotency key', async () => {
    // Break caught: preview trusts stored/private text, allows dashboard access, or accepts loose input.
    const first = await fixtures.household({ childName: 'Avery' });
    const second = await fixtures.household();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(first.parent),
      payload: {
        category: 'BROKEN',
        description: 'Avery saw family-hub.local.',
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_FEEDBACK',
          events: [
            {
              kind: 'API_RESULT',
              at: '2026-08-11T12:00:00.000Z',
              operation: 'GET_PARENT_SNAPSHOT',
              outcome: 'ERROR',
              status: 503,
              errorCode: 'INTERNAL_ERROR',
              durationBucket: 'UNDER_1_SECOND',
              requestId: '10000000-0000-4000-8000-000000000001',
            },
          ],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const receipt = FeedbackSubmissionReceiptSchema.parse(created.json());

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${receipt.id}`,
      headers: actorHeaders(first.parent),
    });
    expect(detail.statusCode).toBe(200);
    const report = FeedbackReportSchema.parse(detail.json());
    expect(report.privacyFindings).toEqual([
      {
        field: 'DESCRIPTION',
        kind: 'KNOWN_PRIVATE_TERM',
        start: 0,
        end: 5,
      },
      { field: 'DESCRIPTION', kind: 'HOSTNAME', start: 10, end: 26 },
    ]);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: report.updatedAt,
        title: 'Avery private title',
        description: 'Reach avery@example.com',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(FeedbackReportSchema.parse(updated.json()).privacyFindings).toEqual([
      {
        field: 'TITLE',
        kind: 'KNOWN_PRIVATE_TERM',
        start: 0,
        end: 5,
      },
      { field: 'DESCRIPTION', kind: 'EMAIL', start: 6, end: 23 },
    ]);

    const previewRequest = {
      publicTitle: 'Avery sync at avery@example.com',
      publicDescription:
        'See [calendar title](http://family-hub.local/private) using Bearer secret-token.',
      includeDiagnostics: true,
    };
    const previewResponse = await app.inject({
      method: 'POST',
      url: `/v1/feedback/${receipt.id}/public-preview`,
      headers: actorHeaders(first.parent),
      payload: previewRequest,
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = FeedbackPublicPreviewSchema.parse(previewResponse.json());
    expect(preview).toMatchObject({
      repositoryUrl: 'https://github.com/family-tests/family-app',
      title: '<family-member> sync at <email>',
      labels: ['feedback', 'app:parent', 'platform:ios', 'type:bug'],
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /Avery|avery@example|calendar title|family-hub|Bearer|secret-token|10000000/i,
    );

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/feedback/${receipt.id}/public-preview`,
      headers: actorHeaders(first.dashboard),
      payload: previewRequest,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(forbidden.json())).toMatchObject({
      code: 'FORBIDDEN',
    });

    const otherHousehold = await app.inject({
      method: 'POST',
      url: `/v1/feedback/${receipt.id}/public-preview`,
      headers: actorHeaders(second.parent),
      payload: previewRequest,
    });
    expect(otherHousehold.statusCode).toBe(404);

    const loose = await app.inject({
      method: 'POST',
      url: `/v1/feedback/${receipt.id}/public-preview`,
      headers: actorHeaders(first.parent),
      payload: { ...previewRequest, token: 'never-echo-private-token' },
    });
    expect(loose.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(loose.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'body.token': expect.any(Array) },
    });
    expect(JSON.stringify(loose.json())).not.toContain(
      'never-echo-private-token',
    );

    const disabledApp = buildApp({
      database: testDatabase!.database,
      nodeEnv: 'test',
      developmentAuthSecret,
    });
    await disabledApp.ready();
    try {
      const disabled = await disabledApp.inject({
        method: 'POST',
        url: `/v1/feedback/${receipt.id}/public-preview`,
        headers: actorHeaders(first.parent),
        payload: previewRequest,
      });
      expect(disabled.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(disabled.json())).toMatchObject({
        code: 'INVALID_STATE',
      });
    } finally {
      await disabledApp.close();
    }
  });

  it('returns 400 with field paths for invalid input', async () => {
    const { parent, household } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers: mutationHeaders(parent),
      payload: {
        householdId: household.id,
        name: '   ',
        imageKey: 'tidy-toys',
        instructions: '',
        defaultValueCents: 12.5,
        defaultDurationMinutes: 0,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'body.defaultDurationMinutes': expect.any(Array),
        'body.defaultValueCents': expect.any(Array),
        'body.instructions': expect.any(Array),
        'body.name': expect.any(Array),
      },
    });
  });

  it('returns a sanitized structured 413 for a payload over 64 KiB', async () => {
    const { parent } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: {
        ...mutationHeaders(parent),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ padding: 'x'.repeat(64 * 1_024) }),
    });

    expect(response.statusCode).toBe(413);
    const body = ApiErrorSchema.parse(response.json());
    expect(body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(JSON.stringify(body)).not.toMatch(/stack|database|postgres/i);
  });

  it('returns a sanitized structured 415 for unsupported media', async () => {
    const { parent } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: {
        ...mutationHeaders(parent),
        'content-type': 'application/xml',
      },
      payload: '<child />',
    });

    expect(response.statusCode).toBe(415);
    const body = ApiErrorSchema.parse(response.json());
    expect(body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(JSON.stringify(body)).not.toMatch(/stack|database|postgres/i);
  });

  it('keeps malformed JSON as a structured 400 validation error', async () => {
    const { parent } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: {
        ...mutationHeaders(parent),
        'content-type': 'application/json',
      },
      payload: '{"name":',
    });

    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('requires a UUID Idempotency-Key on every mutation', async () => {
    const { parent, household } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: actorHeaders(parent),
      payload: {
        householdId: household.id,
        name: 'Missing key',
        color: 'blue',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'headers.idempotency-key': expect.any(Array),
      },
    });
  });

  it('replays only the same canonical payload for an idempotency key', async () => {
    const { parent, household } = await fixtures.household();
    const idempotencyKey = randomUUID();
    const headers = {
      ...actorHeaders(parent),
      'idempotency-key': idempotencyKey,
    };
    const originalPayload = {
      householdId: household.id,
      name: 'Canonical template',
      imageKey: 'tidy-toys',
      instructions: 'Put every toy away.',
      defaultValueCents: 250,
      defaultDurationMinutes: 15,
    };

    const original = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers,
      payload: originalPayload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers,
      payload: {
        defaultDurationMinutes: 15,
        instructions: 'Put every toy away.',
        imageKey: 'tidy-toys',
        name: 'Canonical template',
        householdId: household.id,
        defaultValueCents: 250,
      },
    });
    const changed = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers,
      payload: { ...originalPayload, name: 'Edited after uncertainty' },
    });

    expect(original.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(original.json());
    expect(changed.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(changed.json())).toMatchObject({
      code: 'CONFLICT',
    });
    const rows = await testDatabase!.database.select().from(choreTemplates);
    expect(
      rows.filter(({ householdId }) => householdId === household.id),
    ).toEqual([expect.objectContaining({ name: 'Canonical template' })]);
  });

  it('requires the contracted household field on manual ledger commands', async () => {
    const { child, parent } = await fixtures.household();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/ledger`,
      headers: mutationHeaders(parent),
      payload: {
        amountCents: 100,
        type: 'MANUAL_CREDIT',
        note: 'Missing household field',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'body.householdId': expect.any(Array),
      },
    });
  });

  it('gives dashboards a balance-only endpoint without exposing ledger detail', async () => {
    const { child, dashboard, household, parent } = await fixtures.household();
    const create = await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/ledger`,
      headers: mutationHeaders(parent),
      payload: {
        householdId: household.id,
        amountCents: 375,
        type: 'MANUAL_CREDIT',
        note: 'Private parent note',
      },
    });
    expect(create.statusCode).toBe(201);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/children/${child.id}/ledger`,
      headers: actorHeaders(dashboard),
    });
    expect(detail.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(detail.json())).toMatchObject({
      code: 'FORBIDDEN',
    });

    const balance = await app.inject({
      method: 'GET',
      url: `/v1/children/${child.id}/balance`,
      headers: actorHeaders(dashboard),
    });
    expect(balance.statusCode).toBe(200);
    expect(LedgerBalanceSchema.parse(balance.json())).toEqual({
      householdId: household.id,
      childId: child.id,
      balanceCents: 375,
    });
    expect(Object.keys(balance.json()).sort()).toEqual([
      'balanceCents',
      'childId',
      'householdId',
    ]);

    const parentDetail = await app.inject({
      method: 'GET',
      url: `/v1/children/${child.id}/ledger`,
      headers: actorHeaders(parent),
    });
    expect(parentDetail.statusCode).toBe(200);
    expect(LedgerSummarySchema.parse(parentDetail.json())).toMatchObject({
      balanceCents: 375,
      transactions: [expect.objectContaining({ note: 'Private parent note' })],
    });
  });

  it('returns 409 CHORE_UNAVAILABLE for a lost claim race', async () => {
    const {
      child: firstChild,
      dashboard,
      household,
      parent,
    } = await fixtures.household();
    const secondChild = await createChild(parent, household.id, 'Riley');
    const instance = await createAvailableChore(parent, household.id);

    const claim = (childId: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/chore-instances/${instance.id}/claim`,
        headers: mutationHeaders(dashboard),
        payload: { childId },
      });
    const responses = await Promise.all([
      claim(firstChild.id),
      claim(secondChild.id),
    ]);

    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([
      200, 409,
    ]);
    const lost = responses.find(({ statusCode }) => statusCode === 409)!;
    expect(ApiErrorSchema.parse(lost.json())).toMatchObject({
      code: 'CHORE_UNAVAILABLE',
    });
  });

  it('deeply validates every successful response with @family/contracts', async () => {
    const householdId = randomUUID();
    const parent: ActorContext = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId,
    };
    const dashboard: ActorContext = {
      role: 'DASHBOARD',
      actorId: randomUUID(),
      householdId,
    };

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    HealthStatusSchema.parse(live.json());

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    HealthStatusSchema.parse(ready.json());

    const householdResponse = await app.inject({
      method: 'POST',
      url: '/v1/households',
      headers: mutationHeaders(parent),
      payload: { name: 'API family', timeZone: 'America/New_York' },
    });
    expect(householdResponse.statusCode).toBe(201);
    HouseholdSchema.parse(householdResponse.json());

    await testDatabase!.database.insert(dashboardDevices).values({
      id: dashboard.actorId,
      householdId,
      name: 'API dashboard',
    });

    const primaryChild = await createChild(parent, householdId, 'Avery');
    ChildProfileSchema.parse(primaryChild);
    const secondaryChild = await createChild(parent, householdId, 'Riley');
    ChildProfileSchema.parse(secondaryChild);

    const templateResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers: mutationHeaders(parent),
      payload: {
        householdId,
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        instructions: 'Put the toys in their bins.',
        defaultValueCents: 250,
        defaultDurationMinutes: 15,
      },
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = ChoreTemplateSchema.parse(templateResponse.json());

    const instanceResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-instances',
      headers: mutationHeaders(parent),
      payload: { householdId, choreTemplateId: template.id },
    });
    expect(instanceResponse.statusCode).toBe(201);
    const instance = ChoreInstanceSchema.parse(instanceResponse.json());

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/chore-instances?status=AVAILABLE',
      headers: actorHeaders(dashboard),
    });
    expect(listResponse.statusCode).toBe(200);
    z.array(ChoreInstanceSchema).parse(listResponse.json());

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/claim`,
      headers: mutationHeaders(dashboard),
      payload: { childId: primaryChild.id },
    });
    expect(claimResponse.statusCode).toBe(200);
    ChoreInstanceSchema.parse(claimResponse.json());

    const extendResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/extend`,
      headers: mutationHeaders(parent),
      payload: { additionalMinutes: 5, reason: 'A little more time' },
    });
    expect(extendResponse.statusCode).toBe(200);
    ChoreInstanceSchema.parse(extendResponse.json());

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/cancel`,
      headers: mutationHeaders(parent),
      payload: { reason: 'Restart the test flow' },
    });
    expect(cancelResponse.statusCode).toBe(200);
    ChoreInstanceSchema.parse(cancelResponse.json());

    const reclaimResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/claim`,
      headers: mutationHeaders(dashboard),
      payload: { childId: primaryChild.id },
    });
    expect(reclaimResponse.statusCode).toBe(200);
    ChoreInstanceSchema.parse(reclaimResponse.json());

    const submitResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/submit`,
      headers: mutationHeaders(dashboard),
      payload: { childId: primaryChild.id },
    });
    expect(submitResponse.statusCode).toBe(200);
    const submission = ChoreSubmissionResultSchema.parse(submitResponse.json());

    const parentSnapshotResponse = await app.inject({
      method: 'GET',
      url: '/v1/parent/snapshot',
      headers: actorHeaders(parent),
    });
    expect(parentSnapshotResponse.statusCode).toBe(200);
    ParentSnapshotSchema.parse(parentSnapshotResponse.json());

    const dashboardSnapshotResponse = await app.inject({
      method: 'GET',
      url: '/v1/dashboard/snapshot',
      headers: actorHeaders(dashboard),
    });
    expect(dashboardSnapshotResponse.statusCode).toBe(200);
    DashboardSnapshotSchema.parse(dashboardSnapshotResponse.json());

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${instance.id}/approve`,
      headers: mutationHeaders(parent),
      payload: {
        submissionAttemptId: submission.submissionAttemptId,
        payoutCents: 300,
        note: 'Great job!',
      },
    });
    expect(approveResponse.statusCode).toBe(200);
    ChoreDecisionResultSchema.parse(approveResponse.json());

    const ledgerResponse = await app.inject({
      method: 'GET',
      url: `/v1/children/${primaryChild.id}/ledger`,
      headers: actorHeaders(parent),
    });
    expect(ledgerResponse.statusCode).toBe(200);
    LedgerSummarySchema.parse(ledgerResponse.json());

    const manualResponse = await app.inject({
      method: 'POST',
      url: `/v1/children/${secondaryChild.id}/ledger`,
      headers: mutationHeaders(parent),
      payload: {
        householdId,
        amountCents: 100,
        type: 'MANUAL_CREDIT',
        note: 'Opening credit',
      },
    });
    expect(manualResponse.statusCode).toBe(201);
    LedgerTransactionSchema.parse(manualResponse.json());

    const rejectedInstance = await createAvailableChore(parent, householdId);
    const rejectedClaimResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${rejectedInstance.id}/claim`,
      headers: mutationHeaders(dashboard),
      payload: { childId: secondaryChild.id },
    });
    expect(rejectedClaimResponse.statusCode).toBe(200);
    const rejectedSubmissionResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${rejectedInstance.id}/submit`,
      headers: mutationHeaders(dashboard),
      payload: { childId: secondaryChild.id },
    });
    expect(rejectedSubmissionResponse.statusCode).toBe(200);
    const rejectedSubmission = ChoreSubmissionResultSchema.parse(
      rejectedSubmissionResponse.json(),
    );
    const rejectResponse = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${rejectedInstance.id}/reject`,
      headers: mutationHeaders(parent),
      payload: {
        submissionAttemptId: rejectedSubmission.submissionAttemptId,
        retry: false,
        reason: 'Close this one',
      },
    });
    expect(rejectResponse.statusCode).toBe(200);
    ChoreDecisionResultSchema.parse(rejectResponse.json());
  });

  it('never includes stack traces or database messages in responses', async () => {
    const missingHouseholdParent: ActorContext = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: randomUUID(),
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: mutationHeaders(missingHouseholdParent),
      payload: {
        householdId: missingHouseholdParent.householdId,
        name: 'Cannot exist',
        color: 'red',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = ApiErrorSchema.parse(response.json());
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /stack|foreign key|parent_memberships|postgres|database/i,
    );
  });

  it('fails closed in production without a real authenticator', () => {
    expect(() =>
      buildApp({
        database: testDatabase!.database,
        nodeEnv: 'production',
      }),
    ).toThrow(/production actor authenticator/i);

    expect(() =>
      buildApp({
        database: testDatabase!.database,
        nodeEnv: 'production',
        actorAuthenticator: new DevelopmentActorAuthenticator(
          developmentAuthSecret,
        ),
      }),
    ).toThrow(/development fixture authentication/i);
  });

  it.each([
    '',
    'https://token@github.com/family-tests/family-app',
    'https://github.com:443/family-tests/family-app',
    'https://github.com:8443/family-tests/family-app',
    'https://github.com//family-tests/family-app',
    'https://github.com/family-tests//family-app',
    'https://github.com/family-tests/family-app/',
    'https://github.com/%66amily-tests/family-app',
    'https://github.com/family-tests/family%2Fapp',
    'https://GitHub.com/family-tests/family-app',
    'https://github.com/family-tests/family-app.git',
    'https://github.com/family-tests/family-app?tab=readme',
    'https://github.com/family-tests/family-app#readme',
  ])(
    'fails closed when the app receives unsafe repository URL %j',
    (feedbackGithubRepository) => {
      // Break caught: URL parsing normalizes an unsafe raw repository value into an accepted destination.
      expect(() =>
        buildApp({
          database: testDatabase!.database,
          nodeEnv: 'test',
          developmentAuthSecret,
          feedbackGithubRepository,
        }),
      ).toThrow();
    },
  );

  async function createChild(
    parent: ActorContext,
    householdId: string,
    name: string,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/children',
      headers: mutationHeaders(parent),
      payload: { householdId, name, color: 'blue' },
    });
    expect(response.statusCode).toBe(201);
    return ChildProfileSchema.parse(response.json());
  }

  async function createAvailableChore(
    parent: ActorContext,
    householdId: string,
  ) {
    const templateResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers: mutationHeaders(parent),
      payload: {
        householdId,
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        instructions: 'Put toys away.',
        defaultValueCents: 250,
        defaultDurationMinutes: 15,
      },
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = ChoreTemplateSchema.parse(templateResponse.json());

    const instanceResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-instances',
      headers: mutationHeaders(parent),
      payload: { householdId, choreTemplateId: template.id },
    });
    expect(instanceResponse.statusCode).toBe(201);
    return ChoreInstanceSchema.parse(instanceResponse.json());
  }
});

function actorHeaders(actor: ActorContext) {
  return {
    authorization: `Bearer ${issueDevelopmentActorToken(actor, developmentAuthSecret)}`,
  };
}

function mutationHeaders(actor: ActorContext) {
  return {
    ...actorHeaders(actor),
    'idempotency-key': randomUUID(),
  };
}
