import { randomUUID } from 'node:crypto';

import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { feedbackReports, idempotencyRecords } from '../src/db/schema.js';
import { FeedbackService } from '../src/feedback/service.js';
import {
  deleteClosedFeedbackBefore,
  startFeedbackRetentionWorker,
} from '../src/workers/feedback-retention.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

describe('feedback retention cleanup', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('deletes only CLOSED reports strictly older than the cutoff', async () => {
    // Break caught: retention deletes an open report, a recent closed report, or the cutoff boundary.
    const { household, parent } = await fixtures.household();
    const oldClosedId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'CLOSED',
      at: new Date('2026-07-10T23:59:59.999Z'),
    });
    const cutoffClosedId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'CLOSED',
      at: new Date('2026-07-11T00:00:00.000Z'),
    });
    const recentClosedId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'CLOSED',
      at: new Date('2026-07-12T00:00:00.000Z'),
    });
    const openId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'NEW',
      at: new Date('2026-06-01T00:00:00.000Z'),
    });

    await expect(
      deleteClosedFeedbackBefore(
        testDatabase!.database,
        new Date('2026-07-11T00:00:00.000Z'),
        500,
      ),
    ).resolves.toBe(1);
    expect(await listIds(household.id)).toEqual(
      [cutoffClosedId, recentClosedId, openId].sort(),
    );
    expect(await listIds(household.id)).not.toContain(oldClosedId);
  });

  it('bounds each cleanup to 500 rows and is safe to repeat', async () => {
    // Break caught: one cleanup is unbounded or rerunning removes anything outside the closed-old set.
    const { household, parent } = await fixtures.household();
    const values = Array.from({ length: 501 }, (_, index) =>
      reportValues({
        id: randomUUID(),
        householdId: household.id,
        parentId: parent.actorId,
        status: 'CLOSED',
        at: new Date(
          `2026-06-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
        ),
      }),
    );
    await testDatabase!.database.insert(feedbackReports).values(values);
    const cutoff = new Date('2026-07-11T00:00:00.000Z');

    await expect(
      deleteClosedFeedbackBefore(testDatabase!.database, cutoff, 500),
    ).resolves.toBe(500);
    expect(await listIds(household.id)).toHaveLength(1);
    await expect(
      deleteClosedFeedbackBefore(testDatabase!.database, cutoff, 500),
    ).resolves.toBe(1);
    await expect(
      deleteClosedFeedbackBefore(testDatabase!.database, cutoff, 500),
    ).resolves.toBe(0);
  });

  it('purges private UPDATE replay payloads with exact household/report linkage', async () => {
    // Break caught: retention removes the report but an UPDATE_FEEDBACK replay still returns its private JSON.
    while (
      (await deleteClosedFeedbackBefore(
        testDatabase!.database,
        new Date('2100-01-01T00:00:00.000Z'),
        500,
      )) > 0
    ) {
      // Isolate this retention batch from earlier closed fixtures.
    }
    const first = await fixtures.household();
    const second = await fixtures.household();
    const closedAt = new Date('2026-06-01T00:00:00.000Z');
    const service = new FeedbackService(testDatabase!.database, {
      now: () => new Date(closedAt),
    });
    const createKey = randomUUID();
    const updateKey = randomUUID();
    const createCommand = {
      idempotencyKey: createKey,
      category: 'BROKEN' as const,
      description: 'Initial private feedback.',
      diagnosticSnapshot: {
        source: 'PARENT_IOS' as const,
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK' as const,
        events: [],
      },
    };
    const receipt = await service.createFeedback(first.parent, createCommand);
    const updateCommand = {
      idempotencyKey: updateKey,
      expectedUpdatedAt: receipt.createdAt,
      title: 'Retention secret title',
      description: 'Retention secret description',
      status: 'CLOSED' as const,
    };
    await service.updateFeedback(first.parent, receipt.id, updateCommand);

    const [privateReplay] = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, updateKey));
    expect(JSON.stringify(privateReplay?.response)).toContain(
      'Retention secret description',
    );
    expect(privateReplay).not.toHaveProperty('request');
    expect(privateReplay?.requestHash).not.toContain('Retention secret');

    const deleteKey = randomUUID();
    const unrelatedUpdateKey = randomUUID();
    const otherHouseholdUpdateKey = randomUUID();
    const unrelatedReportId = randomUUID();
    await testDatabase!.database.insert(idempotencyRecords).values([
      idempotencyValues({
        householdId: first.household.id,
        parentId: first.parent.actorId,
        idempotencyKey: deleteKey,
        operation: 'DELETE_FEEDBACK',
        response: { id: receipt.id, deleted: true },
      }),
      idempotencyValues({
        householdId: first.household.id,
        parentId: first.parent.actorId,
        idempotencyKey: unrelatedUpdateKey,
        operation: 'UPDATE_FEEDBACK',
        response: {
          id: unrelatedReportId,
          title: 'Unrelated private title',
        },
      }),
      idempotencyValues({
        householdId: second.household.id,
        parentId: second.parent.actorId,
        idempotencyKey: otherHouseholdUpdateKey,
        operation: 'UPDATE_FEEDBACK',
        response: {
          id: receipt.id,
          title: 'Other household private title',
        },
      }),
    ]);

    await expect(
      deleteClosedFeedbackBefore(
        testDatabase!.database,
        new Date('2026-07-11T00:00:00.000Z'),
        500,
      ),
    ).resolves.toBe(1);

    const protectedKeys = [
      createKey,
      updateKey,
      deleteKey,
      unrelatedUpdateKey,
      otherHouseholdUpdateKey,
    ];
    const remaining = await testDatabase!.database
      .select({
        idempotencyKey: idempotencyRecords.idempotencyKey,
        response: idempotencyRecords.response,
      })
      .from(idempotencyRecords)
      .where(inArray(idempotencyRecords.idempotencyKey, protectedKeys));
    expect(
      new Set(remaining.map(({ idempotencyKey }) => idempotencyKey)),
    ).toEqual(
      new Set([
        createKey,
        deleteKey,
        unrelatedUpdateKey,
        otherHouseholdUpdateKey,
      ]),
    );
    expect(JSON.stringify(remaining)).not.toContain(
      'Retention secret description',
    );
    await expect(
      service.updateFeedback(first.parent, receipt.id, updateCommand),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not postpone closed-report retention when terminal content is edited', async () => {
    // Break caught: editing an already-closed report resets closedAt and extends private-data retention.
    const { household, parent } = await fixtures.household();
    let clock = new Date('2026-06-01T00:00:00.000Z');
    const service = new FeedbackService(testDatabase!.database, {
      now: () => new Date(clock),
    });
    const receipt = await service.createFeedback(parent, {
      idempotencyKey: randomUUID(),
      category: 'BROKEN',
      description: 'Private retention report.',
      diagnosticSnapshot: {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: [],
      },
    });

    clock = new Date('2026-06-02T00:00:00.000Z');
    const closed = await service.updateFeedback(parent, receipt.id, {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: receipt.createdAt,
      status: 'CLOSED',
    });
    clock = new Date('2026-07-20T00:00:00.000Z');
    const edited = await service.updateFeedback(parent, receipt.id, {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: closed.updatedAt,
      description: 'Edited while still closed.',
    });
    expect(edited).toMatchObject({
      closedAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    });

    await expect(
      deleteClosedFeedbackBefore(
        testDatabase!.database,
        new Date('2026-07-01T00:00:00.000Z'),
        500,
      ),
    ).resolves.toBe(1);
    expect(await listIds(household.id)).not.toContain(receipt.id);
  });

  it('stops its unreferenced interval after the immediate cleanup', async () => {
    // Break caught: server shutdown leaves retention scheduled against a closing database.
    while (
      (await deleteClosedFeedbackBefore(
        testDatabase!.database,
        new Date('2100-01-01T00:00:00.000Z'),
        500,
      )) > 0
    ) {
      // Drain closed fixtures left by cutoff-boundary coverage.
    }
    const { household, parent } = await fixtures.household();
    const firstId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'CLOSED',
      at: new Date('2026-07-01T00:00:00.000Z'),
    });
    const logs: Array<Record<string, unknown>> = [];
    const worker = startFeedbackRetentionWorker({
      database: testDatabase!.database,
      intervalMs: 100,
      retentionMs: 30 * 24 * 60 * 60 * 1_000,
      batchSize: 500,
      log: {
        info: (metadata) => logs.push(metadata),
        error: (metadata) => logs.push(metadata),
      },
    });
    await worker.initialCleanup;
    expect(await listIds(household.id)).not.toContain(firstId);
    expect(logs).toEqual([{ deletedCount: 1 }]);

    await worker.stop();
    const afterStopId = await insertReport({
      householdId: household.id,
      parentId: parent.actorId,
      status: 'CLOSED',
      at: new Date('2026-07-01T00:00:00.000Z'),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(await listIds(household.id)).toContain(afterStopId);
    expect(logs).toEqual([{ deletedCount: 1 }]);
  });

  async function insertReport(input: {
    householdId: string;
    parentId: string;
    status: 'NEW' | 'CLOSED';
    at: Date;
  }): Promise<string> {
    const id = randomUUID();
    await testDatabase!.database
      .insert(feedbackReports)
      .values(reportValues({ id, ...input }));
    return id;
  }

  async function listIds(householdId: string): Promise<string[]> {
    const rows = await testDatabase!.database
      .select({ id: feedbackReports.id })
      .from(feedbackReports)
      .where(eq(feedbackReports.householdId, householdId))
      .orderBy(asc(feedbackReports.id));
    return rows.map(({ id }) => id);
  }
});

function reportValues(input: {
  id: string;
  householdId: string;
  parentId: string;
  status: 'NEW' | 'CLOSED';
  at: Date;
}) {
  const isClosed = input.status === 'CLOSED';
  return {
    id: input.id,
    householdId: input.householdId,
    submittedByRole: 'PARENT' as const,
    submittedByParentId: input.parentId,
    submittedByDashboardDeviceId: null,
    category: 'BROKEN' as const,
    title: 'Retention fixture',
    description: 'Private feedback retained until closed and expired.',
    source: 'PARENT_IOS' as const,
    appVersion: '1.2.3',
    screen: 'PARENT_FEEDBACK',
    diagnosticSnapshot: {
      source: 'PARENT_IOS' as const,
      appVersion: '1.2.3',
      currentScreen: 'PARENT_FEEDBACK' as const,
      events: [],
    },
    status: input.status,
    reviewedByParentId: isClosed ? input.parentId : null,
    reviewedAt: isClosed ? input.at : null,
    publicIssueUrl: null,
    exportedAt: null,
    closedAt: isClosed ? input.at : null,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function idempotencyValues(input: {
  householdId: string;
  parentId: string;
  idempotencyKey: string;
  operation: string;
  response: unknown;
}) {
  return {
    householdId: input.householdId,
    idempotencyKey: input.idempotencyKey,
    actorRole: 'PARENT' as const,
    actorParentId: input.parentId,
    actorDashboardDeviceId: null,
    operation: input.operation,
    requestHash: 'a'.repeat(64),
    response: input.response,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  };
}
