import { randomUUID } from 'node:crypto';

import {
  type CreateFeedbackCommand,
  MAX_DIAGNOSTIC_BYTES,
} from '@family/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FeedbackRepository } from '../src/feedback/repository.js';
import { feedbackReports } from '../src/db/schema.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';
import { createFixtures, type HouseholdFixture } from './support/fixtures.js';

describe('feedback repository persistence boundary', () => {
  let testDatabase: TestDatabase;
  let fixture: HouseholdFixture;
  const repository = new FeedbackRepository();

  beforeAll(async () => {
    testDatabase = await startTestDatabase();
    fixture = await createFixtures(testDatabase.database).household();
  }, 60_000);

  afterAll(async () => {
    await testDatabase.stop();
  });

  it('validates and normalizes diagnostics before persisting derived metadata', async () => {
    // Break caught: repository writes trusting a compile-time-only jsonb assertion.
    const command = validCommand({
      description: '  The board stopped responding.  ',
      diagnosticSnapshot: {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: [
          {
            kind: 'NETWORK',
            at: '2026-08-11T12:00:00.000Z',
            state: 'OFFLINE',
          },
        ],
      },
    });

    const report = await testDatabase.database.transaction((transaction) =>
      repository.insert(
        transaction,
        fixture.parent,
        command,
        new Date('2026-08-11T12:05:00.000Z'),
        'Parent iOS feedback',
      ),
    );

    expect(report).toMatchObject({
      householdId: fixture.household.id,
      submittedByRole: 'PARENT',
      submittedByParentId: fixture.parent.actorId,
      submittedByDashboardDeviceId: null,
      description: 'The board stopped responding.',
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      screen: 'PARENT_FEEDBACK',
      diagnosticSnapshot: {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: [
          {
            kind: 'NETWORK',
            at: '2026-08-11T12:00:00.000Z',
            state: 'OFFLINE',
          },
        ],
      },
      status: 'NEW',
      createdAt: new Date('2026-08-11T12:05:00.000Z'),
      updatedAt: new Date('2026-08-11T12:05:00.000Z'),
    });
  });

  it.each([
    [
      'unknown top-level fields',
      {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: [],
        authorization: 'Bearer private-token',
      },
    ],
    [
      'unknown event fields',
      {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_FEEDBACK',
        events: [
          {
            kind: 'NETWORK',
            at: '2026-08-11T12:00:00.000Z',
            state: 'OFFLINE',
            responseBody: 'private response',
          },
        ],
      },
    ],
    ['oversized event arrays', oversizedSnapshot()],
  ])('rejects %s before a repository write', async (_case, snapshot) => {
    // Break caught: hostile diagnostics reaching SQL because TypeScript types were cast around.
    const before = await reportsForFixture(testDatabase, fixture);
    const command = validCommand({ diagnosticSnapshot: snapshot as never });

    await expect(
      testDatabase.database.transaction((transaction) =>
        repository.insert(
          transaction,
          fixture.dashboard,
          command,
          new Date('2026-08-11T12:10:00.000Z'),
          'Dashboard feedback',
        ),
      ),
    ).rejects.toThrow();
    await expect(reportsForFixture(testDatabase, fixture)).resolves.toEqual(
      before,
    );
  });

  it('rejects hostile direct Drizzle values at the database boundary', async () => {
    // Break caught: another repository bypassing FeedbackRepository and writing arbitrary jsonb.
    await expect(
      testDatabase.database.insert(feedbackReports).values({
        householdId: fixture.household.id,
        submittedByRole: 'PARENT',
        submittedByParentId: fixture.parent.actorId,
        category: 'BROKEN',
        title: 'Hostile diagnostics',
        description: 'This value must not reach PostgreSQL.',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        screen: 'PARENT_FEEDBACK',
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_FEEDBACK',
          events: [],
          credential: 'private-token',
        } as never,
      }),
    ).rejects.toThrow();
  });
});

function validCommand(
  overrides: Partial<CreateFeedbackCommand> = {},
): CreateFeedbackCommand {
  return {
    idempotencyKey: randomUUID(),
    category: 'BROKEN',
    description: 'The feedback description.',
    diagnosticSnapshot: {
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      currentScreen: 'PARENT_FEEDBACK',
      events: [],
    },
    ...overrides,
  };
}

function oversizedSnapshot() {
  const event = {
    kind: 'API_RESULT' as const,
    at: '2026-08-11T12:00:00.000Z',
    operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW' as const,
    outcome: 'ERROR' as const,
    status: 599,
    errorCode: 'UNSUPPORTED_MEDIA_TYPE' as const,
    durationBucket: 'FIVE_SECONDS_OR_MORE' as const,
    requestId: '11111111-1111-4111-8111-111111111111',
  };
  const events = Array.from({ length: 100 }, () => ({ ...event }));
  expect(
    new TextEncoder().encode(JSON.stringify(events)).byteLength,
  ).toBeGreaterThan(MAX_DIAGNOSTIC_BYTES);
  return {
    source: 'PARENT_IOS' as const,
    appVersion: '1.2.3',
    currentScreen: 'PARENT_FEEDBACK' as const,
    events,
  };
}

async function reportsForFixture(
  testDatabase: TestDatabase,
  fixture: HouseholdFixture,
) {
  return testDatabase.database
    .select({ id: feedbackReports.id })
    .from(feedbackReports)
    .where(eq(feedbackReports.householdId, fixture.household.id))
    .orderBy(feedbackReports.id);
}
