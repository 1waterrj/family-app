import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  DeletedFeedbackSchema,
  FeedbackListItemSchema,
  FeedbackReportSchema,
  FeedbackSubmissionReceiptSchema,
  type ClientDiagnosticSnapshot,
} from '@family/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../src/app.js';
import {
  issueDevelopmentActorToken,
  type ActorContext,
} from '../src/auth/actor-context.js';
import {
  auditEvents,
  feedbackReports,
  parentMemberships,
} from '../src/db/schema.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

const developmentAuthSecret =
  'test-only-development-auth-secret-with-at-least-32-characters';

describe('private feedback inbox API', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let app: ReturnType<typeof buildApp>;
  let now = new Date('2026-08-11T14:00:00.000Z');

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    app = buildApp({
      database: testDatabase.database,
      nodeEnv: 'test',
      developmentAuthSecret,
      feedbackGithubRepository: 'https://github.com/family-tests/family-app',
      clock: { now: () => new Date(now) },
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase?.stop();
  });

  it('lets parents and paired dashboards create receipt-only reports and replay them idempotently', async () => {
    // Break caught: feedback creation is unregistered, leaks the private report, or duplicates retries.
    const { dashboard, household, parent } = await fixtures.household();
    const dashboardKey = randomUUID();
    const dashboardPayload = validCreateFeedback({
      category: 'CONFUSING',
      description: '  I could not find the finish button.  ',
      diagnosticSnapshot: dashboardSnapshot(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(dashboard, dashboardKey),
      payload: dashboardPayload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(dashboard, dashboardKey),
      payload: dashboardPayload,
    });
    const parentCreated = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(parent),
      payload: validCreateFeedback(),
    });

    expect(created.statusCode).toBe(201);
    const receipt = FeedbackSubmissionReceiptSchema.parse(created.json());
    expect(Object.keys(receipt).sort()).toEqual(['createdAt', 'id', 'status']);
    expect(receipt).toMatchObject({
      status: 'NEW',
      createdAt: '2026-08-11T14:00:00.000Z',
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(receipt);
    expect(parentCreated.statusCode).toBe(201);
    FeedbackSubmissionReceiptSchema.parse(parentCreated.json());

    const stored = await testDatabase!.database
      .select()
      .from(feedbackReports)
      .where(eq(feedbackReports.householdId, household.id));
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submittedByRole: 'DASHBOARD',
          submittedByDashboardDeviceId: dashboard.actorId,
          submittedByParentId: null,
          description: 'I could not find the finish button.',
          source: 'DASHBOARD',
          screen: 'DASHBOARD_FEEDBACK',
        }),
        expect.objectContaining({
          submittedByRole: 'PARENT',
          submittedByDashboardDeviceId: null,
          submittedByParentId: parent.actorId,
          source: 'PARENT_IOS',
        }),
      ]),
    );

    const audit = await testDatabase!.database
      .select({
        eventType: auditEvents.eventType,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(eq(auditEvents.householdId, household.id));
    expect(audit).toEqual(
      expect.arrayContaining([
        {
          eventType: 'FEEDBACK_CREATED',
          payload: {
            category: 'CONFUSING',
            source: 'DASHBOARD',
            status: 'NEW',
          },
        },
        {
          eventType: 'FEEDBACK_CREATED',
          payload: {
            category: 'BROKEN',
            source: 'PARENT_IOS',
            status: 'NEW',
          },
        },
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain(dashboardPayload.description);
    expect(JSON.stringify(audit)).not.toMatch(
      /diagnostic|actorId|submittedBy/i,
    );
  });

  it('binds source and screen metadata to the authenticated actor family', async () => {
    // Break caught: a caller can spoof another application or attach an unrelated screen.
    const { dashboard, parent } = await fixtures.household();
    const cases = [
      {
        actor: dashboard,
        snapshot: parentSnapshot(),
        field: 'body.diagnosticSnapshot.source',
      },
      {
        actor: parent,
        snapshot: dashboardSnapshot(),
        field: 'body.diagnosticSnapshot.source',
      },
      {
        actor: dashboard,
        snapshot: dashboardSnapshot({ currentScreen: 'PARENT_HOME' }),
        field: 'body.diagnosticSnapshot.currentScreen',
      },
      {
        actor: parent,
        snapshot: parentSnapshot({ currentScreen: 'DASHBOARD_HOME' }),
        field: 'body.diagnosticSnapshot.currentScreen',
      },
      {
        actor: dashboard,
        snapshot: dashboardSnapshot({
          events: [
            {
              kind: 'SCREEN',
              at: '2026-08-11T13:59:00.000Z',
              screen: 'PARENT_HOME',
            },
          ],
        }),
        field: 'body.diagnosticSnapshot.events.0.screen',
      },
    ] as const;

    for (const testCase of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: mutationHeaders(testCase.actor),
        payload: validCreateFeedback({
          diagnosticSnapshot: testCase.snapshot,
        }),
      });

      expect(response.statusCode).toBe(400);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'VALIDATION_ERROR',
        fieldErrors: { [testCase.field]: expect.any(Array) },
      });
    }

    for (const actor of [dashboard, parent]) {
      const source =
        actor.role === 'DASHBOARD' ? 'DASHBOARD' : 'PARENT_ANDROID';
      const response = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: mutationHeaders(actor),
        payload: validCreateFeedback({
          diagnosticSnapshot:
            actor.role === 'DASHBOARD'
              ? dashboardSnapshot({
                  currentScreen: 'SETUP',
                  events: [
                    {
                      kind: 'SCREEN',
                      at: '2026-08-11T13:59:00.000Z',
                      screen: 'SETUP',
                    },
                  ],
                })
              : parentSnapshot({
                  source,
                  currentScreen: 'SETUP',
                  events: [
                    {
                      kind: 'SCREEN',
                      at: '2026-08-11T13:59:00.000Z',
                      screen: 'SETUP',
                    },
                  ],
                }),
        }),
      });
      expect(response.statusCode).toBe(201);
      FeedbackSubmissionReceiptSchema.parse(response.json());
    }
  });

  it('gives parents household-scoped list, detail, update, lifecycle, and delete operations', async () => {
    // Break caught: private reports leak across households or update mutable diagnostic metadata/lifecycle timestamps incorrectly.
    const first = await fixtures.household();
    const second = await fixtures.household();
    const older = await createFeedback(first.parent, validCreateFeedback());
    now = new Date('2026-08-11T14:01:00.000Z');
    const newer = await createFeedback(
      first.dashboard,
      validCreateFeedback({
        category: 'IDEA',
        description: 'A newer dashboard idea',
        diagnosticSnapshot: dashboardSnapshot(),
      }),
    );

    const list = await app.inject({
      method: 'GET',
      url: '/v1/feedback',
      headers: actorHeaders(first.parent),
    });
    expect(list.statusCode).toBe(200);
    const items = z.array(FeedbackListItemSchema).parse(list.json());
    expect(items.map(({ id }) => id)).toEqual([newer.id, older.id]);
    expect(items[0]).toMatchObject({
      descriptionPreview: 'A newer dashboard idea',
      hasDiagnostics: true,
      source: 'DASHBOARD',
    });
    expect(JSON.stringify(items)).not.toMatch(
      /submittedBy|actorId|householdId/i,
    );

    const wrongFamilyUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${newer.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T14:01:00.000Z',
        diagnosticEvents: [
          {
            kind: 'SCREEN',
            at: '2026-08-11T14:01:30.000Z',
            screen: 'PARENT_HOME',
          },
        ],
      },
    });
    expect(wrongFamilyUpdate.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(wrongFamilyUpdate.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'body.diagnosticEvents.0.screen': expect.any(Array),
      },
    });

    const otherList = await app.inject({
      method: 'GET',
      url: '/v1/feedback',
      headers: actorHeaders(second.parent),
    });
    expect(otherList.statusCode).toBe(200);
    expect(otherList.json()).toEqual([]);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${older.id}`,
      headers: actorHeaders(first.parent),
    });
    expect(detail.statusCode).toBe(200);
    const original = FeedbackReportSchema.parse(detail.json());
    expect(original).toMatchObject({
      id: older.id,
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      screen: 'PARENT_FEEDBACK',
      privacyFindings: [],
      reviewedAt: null,
      exportedAt: null,
      closedAt: null,
    });
    expect(JSON.stringify(original)).not.toMatch(
      /submittedBy|actorId|householdId|reviewedByParentId/i,
    );

    now = new Date('2026-08-11T14:02:00.000Z');
    const updateKey = randomUUID();
    const updatePayload = {
      expectedUpdatedAt: original.updatedAt,
      title: '  Public-safe title  ',
      description: '  Updated parent description.  ',
      status: 'EXPORTED' as const,
      publicIssueUrl: 'https://github.com/family/app/issues/123',
      diagnosticEvents: [
        {
          kind: 'NETWORK' as const,
          at: '2026-08-11T14:01:30.000Z',
          state: 'OFFLINE' as const,
        },
      ],
    };
    const updatedResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent, updateKey),
      payload: updatePayload,
    });
    const updateReplay = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent, updateKey),
      payload: updatePayload,
    });

    expect(updatedResponse.statusCode).toBe(200);
    const updated = FeedbackReportSchema.parse(updatedResponse.json());
    expect(updated).toMatchObject({
      title: 'Public-safe title',
      description: 'Updated parent description.',
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      screen: 'PARENT_FEEDBACK',
      status: 'EXPORTED',
      reviewedAt: '2026-08-11T14:02:00.000Z',
      exportedAt: '2026-08-11T14:02:00.000Z',
      closedAt: null,
      diagnosticSnapshot: {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: updatePayload.diagnosticEvents,
      },
      privacyFindings: [],
    });
    expect(updateReplay.statusCode).toBe(200);
    expect(updateReplay.json()).toEqual(updated);

    now = new Date('2026-08-11T14:02:30.000Z');
    const editedAfterExportResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T14:02:00.000Z',
        title: 'Edited after export',
      },
    });
    expect(editedAfterExportResponse.statusCode).toBe(200);
    expect(
      FeedbackReportSchema.parse(editedAfterExportResponse.json()),
    ).toMatchObject({
      title: 'Edited after export',
      status: 'EXPORTED',
      reviewedAt: '2026-08-11T14:02:00.000Z',
      exportedAt: '2026-08-11T14:02:00.000Z',
      closedAt: null,
    });

    now = new Date('2026-08-11T14:03:00.000Z');
    const closedResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T14:02:30.000Z',
        status: 'CLOSED',
      },
    });
    expect(closedResponse.statusCode).toBe(200);
    expect(FeedbackReportSchema.parse(closedResponse.json())).toMatchObject({
      status: 'CLOSED',
      exportedAt: null,
      closedAt: '2026-08-11T14:03:00.000Z',
    });

    now = new Date('2026-08-11T14:03:30.000Z');
    const editedAfterCloseResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T14:03:00.000Z',
        description: 'Edited without postponing retention.',
      },
    });
    expect(editedAfterCloseResponse.statusCode).toBe(200);
    expect(
      FeedbackReportSchema.parse(editedAfterCloseResponse.json()),
    ).toMatchObject({
      status: 'CLOSED',
      reviewedAt: '2026-08-11T14:03:00.000Z',
      closedAt: '2026-08-11T14:03:00.000Z',
      updatedAt: '2026-08-11T14:03:30.000Z',
    });

    now = new Date('2026-08-11T14:04:00.000Z');
    const reopenedResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T14:03:30.000Z',
        status: 'READY',
      },
    });
    expect(reopenedResponse.statusCode).toBe(200);
    expect(FeedbackReportSchema.parse(reopenedResponse.json())).toMatchObject({
      status: 'READY',
      exportedAt: null,
      closedAt: null,
    });

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/v1/feedback/${older.id}`,
        headers:
          method === 'GET'
            ? actorHeaders(second.parent)
            : mutationHeaders(second.parent),
        ...(method === 'PATCH'
          ? {
              payload: {
                expectedUpdatedAt: '2026-08-11T14:04:00.000Z',
                title: 'Not allowed',
              },
            }
          : {}),
      });
      expect(response.statusCode).toBe(404);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Resource not found.',
      });
    }

    const deleteKey = randomUUID();
    const deletedResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent, deleteKey),
    });
    const deleteReplay = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${older.id}`,
      headers: mutationHeaders(first.parent, deleteKey),
    });
    expect(deletedResponse.statusCode).toBe(200);
    expect(DeletedFeedbackSchema.parse(deletedResponse.json())).toEqual({
      id: older.id,
      deleted: true,
    });
    expect(deleteReplay.statusCode).toBe(200);
    expect(deleteReplay.json()).toEqual(deletedResponse.json());

    const missing = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${older.id}`,
      headers: actorHeaders(first.parent),
    });
    expect(missing.statusCode).toBe(404);

    const audit = await testDatabase!.database
      .select({
        eventType: auditEvents.eventType,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.householdId, first.household.id),
          eq(auditEvents.entityId, older.id),
        ),
      );
    expect(audit.map(({ eventType }) => eventType)).toEqual([
      'FEEDBACK_CREATED',
      'FEEDBACK_UPDATED',
      'FEEDBACK_UPDATED',
      'FEEDBACK_UPDATED',
      'FEEDBACK_UPDATED',
      'FEEDBACK_UPDATED',
      'FEEDBACK_DELETED',
    ]);
    for (const event of audit) {
      expect(Object.keys(event.payload as object).sort()).toEqual([
        'category',
        'source',
        'status',
      ]);
    }
  });

  it('rejects a stale parent revision without overwriting the accepted scrub', async () => {
    // Break caught: a second parent saves an older draft over a newer privacy scrub.
    const first = await fixtures.household();
    const secondParent: Extract<ActorContext, { role: 'PARENT' }> = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: first.household.id,
    };
    await testDatabase!.database.insert(parentMemberships).values({
      householdId: first.household.id,
      parentId: secondParent.actorId,
    });
    now = new Date('2026-08-11T15:00:00.000Z');
    const receipt = await createFeedback(first.parent, validCreateFeedback());
    const loaded = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${receipt.id}`,
      headers: actorHeaders(first.parent),
    });
    const base = FeedbackReportSchema.parse(loaded.json());

    now = new Date('2026-08-11T15:01:00.000Z');
    const acceptedKey = randomUUID();
    const acceptedPayload = {
      expectedUpdatedAt: base.updatedAt,
      title: 'Private name removed',
      description: 'Sanitized canonical description.',
    };
    const accepted = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent, acceptedKey),
      payload: acceptedPayload,
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedReport = FeedbackReportSchema.parse(accepted.json());

    now = new Date('2026-08-11T15:02:00.000Z');
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(secondParent),
      payload: {
        expectedUpdatedAt: base.updatedAt,
        title: 'Stale private title restored',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(stale.json())).toMatchObject({
      code: 'CONFLICT',
    });

    const acceptedReplay = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent, acceptedKey),
      payload: acceptedPayload,
    });
    expect(acceptedReplay.statusCode).toBe(200);
    expect(acceptedReplay.json()).toEqual(acceptedReport);

    const canonical = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${receipt.id}`,
      headers: actorHeaders(secondParent),
    });
    expect(FeedbackReportSchema.parse(canonical.json())).toMatchObject({
      title: 'Private name removed',
      description: 'Sanitized canonical description.',
      updatedAt: '2026-08-11T15:01:00.000Z',
    });
  });

  it('rejects a noncanonical revision that aliases a stored millisecond and replays the canonical update', async () => {
    // Break caught: Date truncation lets a distinct nanosecond revision pass the repository compare-and-swap.
    const first = await fixtures.household();
    now = new Date('2026-08-11T15:30:00.000Z');
    const receipt = await createFeedback(first.parent, validCreateFeedback());

    const alias = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent),
      payload: {
        expectedUpdatedAt: '2026-08-11T15:30:00.000000001Z',
        title: 'Must not be accepted',
      },
    });
    expect(alias.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(alias.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'body.expectedUpdatedAt': expect.any(Array) },
    });

    now = new Date('2026-08-11T15:31:00.000Z');
    const canonicalKey = randomUUID();
    const canonicalPayload = {
      expectedUpdatedAt: receipt.createdAt,
      title: 'Canonical update',
    };
    const canonical = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent, canonicalKey),
      payload: canonicalPayload,
    });
    const replay = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(first.parent, canonicalKey),
      payload: canonicalPayload,
    });
    expect(canonical.statusCode).toBe(200);
    expect(FeedbackReportSchema.parse(canonical.json())).toMatchObject({
      title: 'Canonical update',
      updatedAt: '2026-08-11T15:31:00.000Z',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(canonical.json());
  });

  it('purges only exact private update replays when a parent explicitly deletes a report', async () => {
    // Break caught: DELETE leaves a replayable private response or broadly removes unrelated safe records.
    const first = await fixtures.household();
    const second = await fixtures.household();
    now = new Date('2026-08-11T16:00:00.000Z');

    const targetCreateKey = randomUUID();
    const targetCreatePayload = validCreateFeedback({
      description: 'Target private description.',
    });
    const targetCreate = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(first.parent, targetCreateKey),
      payload: targetCreatePayload,
    });
    const targetReceipt = FeedbackSubmissionReceiptSchema.parse(
      targetCreate.json(),
    );
    const targetUpdateKey = randomUUID();
    const targetUpdatePayload = {
      expectedUpdatedAt: targetReceipt.createdAt,
      title: 'Target private replay title',
      description: 'Target private replay description.',
    };
    const targetUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${targetReceipt.id}`,
      headers: mutationHeaders(first.parent, targetUpdateKey),
      payload: targetUpdatePayload,
    });
    expect(targetUpdate.statusCode).toBe(200);

    const unrelatedReceipt = await createFeedback(
      first.parent,
      validCreateFeedback({ description: 'Unrelated private report.' }),
    );
    const unrelatedUpdateKey = randomUUID();
    const unrelatedUpdatePayload = {
      expectedUpdatedAt: unrelatedReceipt.createdAt,
      title: 'Unrelated replay title',
    };
    const unrelatedUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${unrelatedReceipt.id}`,
      headers: mutationHeaders(first.parent, unrelatedUpdateKey),
      payload: unrelatedUpdatePayload,
    });
    expect(unrelatedUpdate.statusCode).toBe(200);

    const otherReceipt = await createFeedback(
      second.parent,
      validCreateFeedback({ description: 'Other household report.' }),
    );
    const otherUpdateKey = randomUUID();
    const otherUpdatePayload = {
      expectedUpdatedAt: otherReceipt.createdAt,
      title: 'Other household replay title',
    };
    const otherUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${otherReceipt.id}`,
      headers: mutationHeaders(second.parent, otherUpdateKey),
      payload: otherUpdatePayload,
    });
    expect(otherUpdate.statusCode).toBe(200);

    const deleteKey = randomUUID();
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${targetReceipt.id}`,
      headers: mutationHeaders(first.parent, deleteKey),
    });
    expect(deleted.statusCode).toBe(200);

    const removedUpdateReplay = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${targetReceipt.id}`,
      headers: mutationHeaders(first.parent, targetUpdateKey),
      payload: targetUpdatePayload,
    });
    expect(removedUpdateReplay.statusCode).toBe(404);

    const [createReplay, deleteReplay, unrelatedReplay, otherReplay] =
      await Promise.all([
        app.inject({
          method: 'POST',
          url: '/v1/feedback',
          headers: mutationHeaders(first.parent, targetCreateKey),
          payload: targetCreatePayload,
        }),
        app.inject({
          method: 'DELETE',
          url: `/v1/feedback/${targetReceipt.id}`,
          headers: mutationHeaders(first.parent, deleteKey),
        }),
        app.inject({
          method: 'PATCH',
          url: `/v1/feedback/${unrelatedReceipt.id}`,
          headers: mutationHeaders(first.parent, unrelatedUpdateKey),
          payload: unrelatedUpdatePayload,
        }),
        app.inject({
          method: 'PATCH',
          url: `/v1/feedback/${otherReceipt.id}`,
          headers: mutationHeaders(second.parent, otherUpdateKey),
          payload: otherUpdatePayload,
        }),
      ]);
    expect(createReplay.json()).toEqual(targetCreate.json());
    expect(deleteReplay.json()).toEqual(deleted.json());
    expect(unrelatedReplay.json()).toEqual(unrelatedUpdate.json());
    expect(otherReplay.json()).toEqual(otherUpdate.json());
  });

  it('treats dashboard device names as private and publishes only safe app-version metadata', async () => {
    // Break caught: device labels leak through parent text while approved version metadata is missing.
    const { dashboard, parent } = await fixtures.household();
    now = new Date('2026-08-11T17:00:00.000Z');
    const receipt = await createFeedback(
      dashboard,
      validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    );
    const loaded = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${receipt.id}`,
      headers: actorHeaders(parent),
    });
    const report = FeedbackReportSchema.parse(loaded.json());
    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${receipt.id}`,
      headers: mutationHeaders(parent),
      payload: {
        expectedUpdatedAt: report.updatedAt,
        description: 'Fixture dashboard stopped responding.',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(FeedbackReportSchema.parse(updated.json()).privacyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'DESCRIPTION',
          kind: 'KNOWN_PRIVATE_TERM',
        }),
      ]),
    );

    const preview = await app.inject({
      method: 'POST',
      url: `/v1/feedback/${receipt.id}/public-preview`,
      headers: actorHeaders(parent),
      payload: {
        publicTitle: 'Fixture dashboard issue',
        publicDescription: 'Fixture dashboard stopped responding.',
        includeDiagnostics: false,
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      title: '<family-member> issue',
    });
    expect(preview.json().body).toContain('App version: 2.0.0');
    expect(JSON.stringify(preview.json())).not.toContain('Fixture dashboard');
  });

  it('forbids dashboards from every inbox route after returning a create receipt', async () => {
    // Break caught: receipt access accidentally grants a dashboard read or mutation capability.
    const { dashboard } = await fixtures.household();
    const receipt = await createFeedback(
      dashboard,
      validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    );
    const requests = [
      app.inject({
        method: 'GET',
        url: '/v1/feedback',
        headers: actorHeaders(dashboard),
      }),
      app.inject({
        method: 'GET',
        url: `/v1/feedback/${receipt.id}`,
        headers: actorHeaders(dashboard),
      }),
      app.inject({
        method: 'PATCH',
        url: `/v1/feedback/${receipt.id}`,
        headers: mutationHeaders(dashboard),
        payload: {
          expectedUpdatedAt: receipt.createdAt,
          status: 'CLOSED',
        },
      }),
      app.inject({
        method: 'DELETE',
        url: `/v1/feedback/${receipt.id}`,
        headers: mutationHeaders(dashboard),
      }),
    ];

    for (const request of requests) {
      const response = await request;
      expect(response.statusCode).toBe(403);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('rejects stale parent tokens after membership revocation on list and detail reads', async () => {
    // Break caught: read authorization trusts stale signed claims after family membership is revoked.
    const { dashboard, household, parent } = await fixtures.household();
    const receipt = await createFeedback(
      dashboard,
      validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    );

    await testDatabase!.database
      .delete(parentMemberships)
      .where(
        and(
          eq(parentMemberships.householdId, household.id),
          eq(parentMemberships.parentId, parent.actorId),
        ),
      );

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/feedback',
        headers: actorHeaders(parent),
      }),
      app.inject({
        method: 'GET',
        url: `/v1/feedback/${receipt.id}`,
        headers: actorHeaders(parent),
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Resource not found.',
      });
    }
  });

  it('authorizes every feedback idempotent replay against live actor membership', async () => {
    // Break caught: a correctly signed but revoked actor receives a stored private CREATE, UPDATE, or DELETE response before current membership is checked.
    const createSetup = await fixtures.household();
    const createKey = randomUUID();
    const createPayload = validCreateFeedback({
      description: 'CREATE REPLAY PRIVATE CANARY',
      diagnosticSnapshot: dashboardSnapshot(),
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(createSetup.dashboard, createKey),
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    await forceRevokeActor('dashboard_devices', createSetup.dashboard.actorId);
    const createReplay = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(createSetup.dashboard, createKey),
      payload: createPayload,
    });

    const updateSetup = await fixtures.household();
    const updateReceipt = await createFeedback(
      updateSetup.dashboard,
      validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    );
    const updateKey = randomUUID();
    const updatePayload = {
      expectedUpdatedAt: updateReceipt.createdAt,
      title: 'UPDATE REPLAY PRIVATE CANARY',
    };
    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${updateReceipt.id}`,
      headers: mutationHeaders(updateSetup.parent, updateKey),
      payload: updatePayload,
    });
    expect(updated.statusCode).toBe(200);
    await forceRevokeActor('parent_memberships', updateSetup.parent.actorId);
    const updateReplay = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${updateReceipt.id}`,
      headers: mutationHeaders(updateSetup.parent, updateKey),
      payload: updatePayload,
    });

    const deleteSetup = await fixtures.household();
    const deleteReceipt = await createFeedback(
      deleteSetup.dashboard,
      validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    );
    const deleteKey = randomUUID();
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${deleteReceipt.id}`,
      headers: mutationHeaders(deleteSetup.parent, deleteKey),
    });
    expect(deleted.statusCode).toBe(200);
    await forceRevokeActor('parent_memberships', deleteSetup.parent.actorId);
    const deleteReplay = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${deleteReceipt.id}`,
      headers: mutationHeaders(deleteSetup.parent, deleteKey),
    });

    for (const response of [createReplay, updateReplay, deleteReplay]) {
      expect(response.statusCode).toBe(404);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Resource not found.',
      });
      expect(JSON.stringify(response.json())).not.toMatch(
        /REPLAY PRIVATE CANARY|diagnosticSnapshot|publicIssueUrl/iu,
      );
    }
  });

  it('transactionally limits a dashboard to five submissions per ten minutes while replaying accepted keys', async () => {
    // Break caught: limit checks occur outside idempotent locked work or count another actor's reports.
    const { dashboard, household } = await fixtures.household();
    const accepted: Array<{ key: string; receipt: unknown }> = [];

    for (let index = 0; index < 5; index += 1) {
      const key = randomUUID();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: mutationHeaders(dashboard, key),
        payload: validCreateFeedback({
          description: `Dashboard report ${index + 1}`,
          diagnosticSnapshot: dashboardSnapshot(),
        }),
      });
      expect(response.statusCode).toBe(201);
      accepted.push({
        key,
        receipt: FeedbackSubmissionReceiptSchema.parse(response.json()),
      });
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(dashboard),
      payload: validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    });
    expect(limited.statusCode).toBe(429);
    expect(ApiErrorSchema.parse(limited.json())).toMatchObject({
      code: 'RATE_LIMITED',
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(dashboard, accepted[0]!.key),
      payload: validCreateFeedback({
        description: 'Dashboard report 1',
        diagnosticSnapshot: dashboardSnapshot(),
      }),
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(accepted[0]!.receipt);

    const reports = await testDatabase!.database
      .select()
      .from(feedbackReports)
      .where(eq(feedbackReports.householdId, household.id));
    expect(reports).toHaveLength(5);
  });

  it('serializes an aligned dashboard burst into five receipts and a contracted overflow', async () => {
    // Break caught: serializable retry exhaustion returns 500 during a six-request burst.
    const { dashboard, household } = await fixtures.household();
    const submissions = Array.from({ length: 6 }, (_, index) => ({
      key: randomUUID(),
      payload: validCreateFeedback({
        description: `Concurrent dashboard report ${index + 1}`,
        diagnosticSnapshot: dashboardSnapshot(),
      }),
    }));
    const start = Promise.withResolvers<void>();
    const requests = submissions.map(({ key, payload }) =>
      start.promise.then(() =>
        app.inject({
          method: 'POST',
          url: '/v1/feedback',
          headers: mutationHeaders(dashboard, key),
          payload,
        }),
      ),
    );

    start.resolve();
    const responses = await Promise.all(requests);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([
      201, 201, 201, 201, 201, 429,
    ]);

    const accepted = responses
      .map((response, index) => ({ response, submission: submissions[index]! }))
      .filter(({ response }) => response.statusCode === 201)
      .map(({ response, submission }) => ({
        receipt: FeedbackSubmissionReceiptSchema.parse(response.json()),
        submission,
      }));
    expect(new Set(accepted.map(({ receipt }) => receipt.id)).size).toBe(5);
    const overflow = responses.find(({ statusCode }) => statusCode !== 201)!;
    expect(ApiErrorSchema.parse(overflow.json())).toMatchObject({
      code: 'RATE_LIMITED',
    });

    const reports = await testDatabase!.database
      .select()
      .from(feedbackReports)
      .where(eq(feedbackReports.householdId, household.id));
    expect(reports).toHaveLength(5);

    const replayTarget = accepted[0]!;
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(dashboard, replayTarget.submission.key),
      payload: replayTarget.submission.payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(replayTarget.receipt);
  });

  it('rejects stale/unpaired actors and maps strict validation paths without leaking internals', async () => {
    // Break caught: signed but deleted actors write through foreign-key failures or loose route schemas accept extra fields.
    const household = await fixtures.household();
    const unpairedDashboard: ActorContext = {
      role: 'DASHBOARD',
      actorId: randomUUID(),
      householdId: household.household.id,
    };
    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: actorHeaders(household.parent),
      payload: validCreateFeedback(),
    });
    expect(missingKey.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(missingKey.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'headers.idempotency-key': expect.any(Array) },
    });

    const invalidBody = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(household.parent),
      payload: {
        ...validCreateFeedback(),
        category: 'OTHER',
        authorization: 'private-secret',
      },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(invalidBody.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'body.category': expect.any(Array),
        'body.authorization': expect.any(Array),
      },
    });
    expect(JSON.stringify(invalidBody.json())).not.toContain('private-secret');

    const invalidPath = await app.inject({
      method: 'GET',
      url: '/v1/feedback/not-a-uuid',
      headers: actorHeaders(household.parent),
    });
    expect(invalidPath.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(invalidPath.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'path.id': expect.any(Array) },
    });

    const looseUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/feedback/${randomUUID()}`,
      headers: mutationHeaders(household.parent),
      payload: { requestBody: 'private-secret' },
    });
    expect(looseUpdate.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(looseUpdate.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'body.requestBody': expect.any(Array) },
    });

    const looseDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/feedback/${randomUUID()}`,
      headers: mutationHeaders(household.parent),
      payload: { token: 'private-secret' },
    });
    expect(looseDelete.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(looseDelete.json())).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'body.token': expect.any(Array) },
    });

    const unpaired = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(unpairedDashboard),
      payload: validCreateFeedback({ diagnosticSnapshot: dashboardSnapshot() }),
    });
    expect(unpaired.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(unpaired.json())).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Resource not found.',
    });
    expect(JSON.stringify(unpaired.json())).not.toMatch(
      /foreign key|dashboard_devices|postgres|database/i,
    );
  });

  it('strictly rejects query fields on create, update, and delete mutations', async () => {
    // Break caught: feedback mutations silently accept uncontracted query input.
    const { parent } = await fixtures.household();
    const updateTarget = await createFeedback(parent, validCreateFeedback());
    const deleteTarget = await createFeedback(parent, validCreateFeedback());
    const requests = [
      app.inject({
        method: 'POST',
        url: '/v1/feedback?debug=private-secret',
        headers: mutationHeaders(parent),
        payload: validCreateFeedback(),
      }),
      app.inject({
        method: 'PATCH',
        url: `/v1/feedback/${updateTarget.id}?debug=private-secret`,
        headers: mutationHeaders(parent),
        payload: { title: 'Query must be rejected' },
      }),
      app.inject({
        method: 'DELETE',
        url: `/v1/feedback/${deleteTarget.id}?debug=private-secret`,
        headers: mutationHeaders(parent),
      }),
    ];

    for (const request of requests) {
      const response = await request;
      expect(response.statusCode).toBe(400);
      expect(ApiErrorSchema.parse(response.json())).toMatchObject({
        code: 'VALIDATION_ERROR',
        fieldErrors: { 'query.debug': expect.any(Array) },
      });
      expect(JSON.stringify(response.json())).not.toContain('private-secret');
    }
  });

  async function createFeedback(
    actor: ActorContext,
    payload: ReturnType<typeof validCreateFeedback>,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: mutationHeaders(actor),
      payload,
    });
    expect(response.statusCode).toBe(201);
    return FeedbackSubmissionReceiptSchema.parse(response.json());
  }

  async function forceRevokeActor(
    table: 'dashboard_devices' | 'parent_memberships',
    actorId: string,
  ): Promise<void> {
    const actorColumn = table === 'dashboard_devices' ? 'id' : 'parent_id';
    await testDatabase!.sql.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM ${table} WHERE ${actorColumn} = '${actorId}';
      SET session_replication_role = origin;
    `);
  }
});

function validCreateFeedback(
  overrides: Partial<{
    category: 'BROKEN' | 'CONFUSING' | 'IDEA';
    description: string;
    diagnosticSnapshot: ClientDiagnosticSnapshot;
  }> = {},
) {
  return {
    category: 'BROKEN' as const,
    description: 'The board stopped responding.',
    diagnosticSnapshot: parentSnapshot(),
    ...overrides,
  };
}

function parentSnapshot(
  overrides: Partial<ClientDiagnosticSnapshot> = {},
): ClientDiagnosticSnapshot {
  return {
    source: 'PARENT_IOS',
    appVersion: '1.2.3',
    currentScreen: 'PARENT_FEEDBACK',
    events: [
      {
        kind: 'SCREEN',
        at: '2026-08-11T13:59:00.000Z',
        screen: 'PARENT_FEEDBACK',
      },
    ],
    ...overrides,
  };
}

function dashboardSnapshot(
  overrides: Partial<ClientDiagnosticSnapshot> = {},
): ClientDiagnosticSnapshot {
  return {
    source: 'DASHBOARD',
    appVersion: '2.0.0',
    currentScreen: 'DASHBOARD_FEEDBACK',
    events: [
      {
        kind: 'SCREEN',
        at: '2026-08-11T13:59:00.000Z',
        screen: 'DASHBOARD_FEEDBACK',
      },
    ],
    ...overrides,
  };
}

function actorHeaders(actor: ActorContext) {
  return {
    authorization: `Bearer ${issueDevelopmentActorToken(actor, developmentAuthSecret)}`,
  };
}

function mutationHeaders(actor: ActorContext, idempotencyKey = randomUUID()) {
  return {
    ...actorHeaders(actor),
    'idempotency-key': idempotencyKey,
  };
}
