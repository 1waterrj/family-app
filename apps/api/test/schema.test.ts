import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ApiErrorCodeSchema,
  FeedbackApiOperationSchema,
  FeedbackDurationBucketSchema,
  FeedbackScreenSchema,
  MAX_DIAGNOSTIC_BYTES,
} from '@family/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChoreService } from '../src/chores/service.js';
import {
  runMigrations,
  startTestDatabase,
  type TestDatabase,
} from './support/database.js';

interface HouseholdFixture {
  childId: string;
  choreInstanceId: string;
  choreTemplateId: string;
  dashboardDeviceId: string;
  householdId: string;
  parentId: string;
}

describe('core schema', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  });

  async function insertApproval({
    householdId,
    childId,
    parentId,
    choreInstanceId,
    idempotencyKey,
  }: HouseholdFixture & { idempotencyKey: string }) {
    const [existingAttempt] = await database!.sql<{ id: string }[]>`
      SELECT id
      FROM chore_submission_attempts
      WHERE household_id = ${householdId}
        AND chore_instance_id = ${choreInstanceId}
        AND attempt_number = 1
    `;
    const [createdAttempt] = existingAttempt
      ? [undefined]
      : await database!.sql<{ id: string }[]>`
          INSERT INTO chore_submission_attempts (
            household_id,
            chore_instance_id,
            claimed_by_child_id,
            attempt_number,
            submitted_at
          )
          VALUES (${householdId}, ${choreInstanceId}, ${childId}, 1, now())
          RETURNING id
        `;
    const submissionAttemptId = existingAttempt?.id ?? createdAttempt!.id;

    return database!.sql`
      INSERT INTO approval_decisions (
        id,
        household_id,
        chore_instance_id,
        submission_attempt_id,
        decided_by_parent_id,
        decision,
        idempotency_key
      )
      VALUES (
        ${randomUUID()},
        ${householdId},
        ${choreInstanceId},
        ${submissionAttemptId},
        ${parentId},
        'APPROVED',
        ${idempotencyKey}
      )
      RETURNING id
    `;
  }

  async function insertIdempotencyRecord(
    fixture: HouseholdFixture,
    idempotencyKey: string,
  ) {
    return database!.sql`
      INSERT INTO idempotency_records (
        household_id,
        idempotency_key,
        actor_role,
        actor_parent_id,
        operation,
        request_hash
      )
      VALUES (
        ${fixture.householdId},
        ${idempotencyKey},
        'PARENT',
        ${fixture.parentId},
        'APPROVE_CHORE',
        'schema-test'
      )
    `;
  }

  async function insertFeedbackReport(
    fixture: HouseholdFixture,
    overrides: {
      appVersion?: string;
      category?: string;
      closedAt?: Date | null;
      createdAt?: Date;
      description?: string;
      diagnosticSnapshot?: unknown;
      exportedAt?: Date | null;
      id?: string;
      publicIssueUrl?: string | null;
      reviewedAt?: Date | null;
      reviewedByParentId?: string | null;
      screen?: string;
      source?: string;
      status?: string;
      submittedByDashboardDeviceId?: string | null;
      submittedByParentId?: string | null;
      submittedByRole?: string;
      title?: string;
      updatedAt?: Date;
    } = {},
  ) {
    const submittedByRole = overrides.submittedByRole ?? 'PARENT';
    const submittedByParentId =
      overrides.submittedByParentId === undefined
        ? fixture.parentId
        : overrides.submittedByParentId;
    const submittedByDashboardDeviceId =
      overrides.submittedByDashboardDeviceId ?? null;
    const appVersion = overrides.appVersion ?? '1.2.3';
    const screen = overrides.screen ?? 'PARENT_CHORES';
    const diagnosticSnapshot = overrides.diagnosticSnapshot ?? {
      source: overrides.source ?? 'PARENT_IOS',
      appVersion,
      currentScreen: screen,
      events: [],
    };
    const createdAt =
      overrides.createdAt ?? new Date('2026-08-11T12:00:00.000Z');
    const updatedAt = overrides.updatedAt ?? createdAt;

    return database!.sql`
      INSERT INTO feedback_reports (
        id,
        household_id,
        submitted_by_role,
        submitted_by_parent_id,
        submitted_by_dashboard_device_id,
        category,
        title,
        description,
        source,
        app_version,
        screen,
        diagnostic_snapshot,
        status,
        reviewed_by_parent_id,
        reviewed_at,
        public_issue_url,
        exported_at,
        closed_at,
        created_at,
        updated_at
      )
      VALUES (
        ${overrides.id ?? randomUUID()},
        ${fixture.householdId},
        ${submittedByRole},
        ${submittedByParentId},
        ${submittedByDashboardDeviceId},
        ${overrides.category ?? 'BROKEN'},
        ${overrides.title ?? 'Chore submission is stuck'},
        ${overrides.description ?? 'The submit button did not finish.'},
        ${overrides.source ?? 'PARENT_IOS'},
        ${appVersion},
        ${screen},
        ${JSON.stringify(diagnosticSnapshot)}::jsonb,
        ${overrides.status ?? 'NEW'},
        ${overrides.reviewedByParentId ?? null},
        ${overrides.reviewedAt?.toISOString() ?? null},
        ${overrides.publicIssueUrl ?? null},
        ${overrides.exportedAt?.toISOString() ?? null},
        ${overrides.closedAt?.toISOString() ?? null},
        ${createdAt.toISOString()},
        ${updatedAt.toISOString()}
      )
      RETURNING id
    `;
  }

  it('requires feedback submitter columns to match the parent or dashboard role', async () => {
    // Break caught: role attribution becoming ambiguous or accepting two actors.
    const fixture = await createHouseholdFixture(database!);

    await expect(insertFeedbackReport(fixture)).resolves.toHaveLength(1);
    await expect(
      insertFeedbackReport(fixture, {
        source: 'DASHBOARD',
        submittedByDashboardDeviceId: fixture.dashboardDeviceId,
        submittedByParentId: null,
        submittedByRole: 'DASHBOARD',
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insertFeedbackReport(fixture, {
        submittedByDashboardDeviceId: fixture.dashboardDeviceId,
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, {
        submittedByDashboardDeviceId: fixture.dashboardDeviceId,
        submittedByRole: 'DASHBOARD',
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, { submittedByParentId: null }),
    ).rejects.toThrow(/check/i);
  });

  it('keeps feedback actors within the report household', async () => {
    // Break caught: a cross-household parent or reviewer being attached by ID.
    const fixture = await createHouseholdFixture(database!);
    const other = await createHouseholdFixture(database!);

    await expect(
      insertFeedbackReport(fixture, {
        submittedByParentId: other.parentId,
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      insertFeedbackReport(fixture, {
        source: 'DASHBOARD',
        submittedByDashboardDeviceId: other.dashboardDeviceId,
        submittedByParentId: null,
        submittedByRole: 'DASHBOARD',
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      database!.sql`
        INSERT INTO feedback_reports (
          household_id,
          submitted_by_role,
          submitted_by_dashboard_device_id,
          category,
          title,
          description,
          source,
          app_version,
          screen,
          diagnostic_snapshot,
          reviewed_by_parent_id,
          reviewed_at,
          updated_at
        )
        VALUES (
          ${fixture.householdId},
          'DASHBOARD',
          ${fixture.dashboardDeviceId},
          'CONFUSING',
          'Chore status is unclear',
          'The board did not explain the status.',
          'DASHBOARD',
          '1.2.3',
          'DASHBOARD_CHORE_BOARD',
          ${JSON.stringify({
            source: 'DASHBOARD',
            appVersion: '1.2.3',
            currentScreen: 'DASHBOARD_CHORE_BOARD',
            events: [],
          })}::jsonb,
          ${other.parentId},
          now(),
          now()
        )
      `,
    ).rejects.toThrow(/foreign key/i);
  });

  it('enforces feedback text limits and contracted enum states', async () => {
    // Break caught: oversized private reports or unhandled workflow values persisting.
    const fixture = await createHouseholdFixture(database!);

    await expect(
      insertFeedbackReport(fixture, {
        title: 'x'.repeat(160),
        description: 'x'.repeat(2_000),
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insertFeedbackReport(fixture, { title: 'x'.repeat(161) }),
    ).rejects.toThrow(/value too long/i);
    await expect(
      insertFeedbackReport(fixture, { description: 'x'.repeat(2_001) }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, { category: 'OTHER' }),
    ).rejects.toThrow(/enum/i);
    await expect(
      insertFeedbackReport(fixture, { source: 'WEB' }),
    ).rejects.toThrow(/enum/i);
    await expect(
      insertFeedbackReport(fixture, { status: 'ARCHIVED' }),
    ).rejects.toThrow(/enum/i);
  });

  it('rejects hostile diagnostic JSON at the raw database boundary', async () => {
    // Break caught: jsonb accepting arbitrary objects, unknown event fields, or oversized event payloads.
    const fixture = await createHouseholdFixture(database!);
    const apiResult = {
      kind: 'API_RESULT',
      at: '2026-08-11T12:00:00.000Z',
      operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW',
      outcome: 'ERROR',
      status: 599,
      errorCode: 'UNSUPPORTED_MEDIA_TYPE',
      durationBucket: 'FIVE_SECONDS_OR_MORE',
      requestId: '11111111-1111-4111-8111-111111111111',
    };

    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: { secret: 'Bearer private-token' },
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_CHORES',
          events: [],
          authorization: 'Bearer private-token',
        },
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_CHORES',
          events: [{ ...apiResult, responseBody: 'private response' }],
        },
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_CHORES',
          events: Array.from({ length: 100 }, () => ({ ...apiResult })),
        },
      }),
    ).rejects.toThrow(/check/i);
  });

  it('accepts every contracted diagnostic enum value at the raw database boundary', async () => {
    // Break caught: the database validator drifting behind any shared diagnostic enum.
    const fixture = await createHouseholdFixture(database!);
    const at = '2026-08-11T12:00:00.000Z';
    const events = [
      ...FeedbackScreenSchema.options.map((screen) => ({
        kind: 'SCREEN',
        at,
        screen,
      })),
      { kind: 'NETWORK', at, state: 'ONLINE' },
      { kind: 'NETWORK', at, state: 'OFFLINE' },
      ...FeedbackApiOperationSchema.options.map((operation) => ({
        kind: 'API_RESULT',
        at,
        operation,
        outcome: 'SUCCESS',
        status: 200,
        errorCode: null,
        durationBucket: 'UNDER_250_MS',
        requestId: null,
      })),
      ...ApiErrorCodeSchema.options.map((errorCode) => ({
        kind: 'API_RESULT',
        at,
        operation: 'CREATE_FEEDBACK',
        outcome: 'ERROR',
        status: 500,
        errorCode,
        durationBucket: 'UNDER_1_SECOND',
        requestId: null,
      })),
      ...FeedbackDurationBucketSchema.options.map((durationBucket) => ({
        kind: 'API_RESULT',
        at,
        operation: 'CREATE_FEEDBACK',
        outcome: 'SUCCESS',
        status: 201,
        errorCode: null,
        durationBucket,
        requestId: '11111111-1111-4111-8111-111111111111',
      })),
    ];

    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_CHORES',
          events,
        },
      }),
    ).resolves.toHaveLength(1);
  });

  it('accepts compact diagnostic events up to the contracted byte limit', async () => {
    // Break caught: jsonb display whitespace rejecting a compact payload accepted by the shared schema.
    const fixture = await createHouseholdFixture(database!);
    const event = {
      kind: 'API_RESULT',
      at: '2026-08-11T12:00:00.000Z',
      operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW',
      outcome: 'ERROR',
      status: 599,
      errorCode: 'UNSUPPORTED_MEDIA_TYPE',
      durationBucket: 'FIVE_SECONDS_OR_MORE',
      requestId: '11111111-1111-4111-8111-111111111111',
    };
    const events = Array.from({ length: 95 }, () => ({ ...event }));
    expect(
      new TextEncoder().encode(JSON.stringify(events)).byteLength,
    ).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);

    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: {
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          currentScreen: 'PARENT_CHORES',
          events,
        },
      }),
    ).resolves.toHaveLength(1);
  });

  it('requires diagnostic snapshot metadata to match indexed report metadata', async () => {
    // Break caught: queries grouping one source/version/screen while the private snapshot claims another.
    const fixture = await createHouseholdFixture(database!);

    for (const diagnosticSnapshot of [
      {
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_CHORES',
        events: [],
      },
      {
        source: 'PARENT_IOS',
        appVersion: '9.9.9',
        currentScreen: 'PARENT_CHORES',
        events: [],
      },
      {
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        currentScreen: 'PARENT_HOME',
        events: [],
      },
    ]) {
      await expect(
        insertFeedbackReport(fixture, { diagnosticSnapshot }),
      ).rejects.toThrow(/check/i);
    }
  });

  it('aligns stored app versions with the conservative public metadata grammar', async () => {
    // Break caught: PostgreSQL admits prose, URLs, credentials, or whitespace rejected by the shared contract.
    const fixture = await createHouseholdFixture(database!);
    for (const acceptedVersion of [
      'development',
      '1.2.3',
      '1.2.3-beta.1',
      '1.2.3-01alpha',
      '1.2.3+20260811.42',
      '1.2.3-beta.1+build.42',
    ]) {
      await expect(
        insertFeedbackReport(fixture, {
          appVersion: acceptedVersion,
          diagnosticSnapshot: {
            source: 'PARENT_IOS',
            appVersion: acceptedVersion,
            currentScreen: 'PARENT_CHORES',
            events: [],
          },
        }),
      ).resolves.toHaveLength(1);
    }
    for (const rejectedVersion of [
      ' 1.2.3',
      '1.2.3\n',
      '1.2.3-01',
      'https://family.example/app/1.2.3',
      'Bearer private-token',
      'github_' + 'pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'the version from the test phone',
      'v'.repeat(160),
      `1.2.3+${'b'.repeat(155)}`,
    ]) {
      await expect(
        insertFeedbackReport(fixture, {
          appVersion: rejectedVersion,
          diagnosticSnapshot: {
            source: 'PARENT_IOS',
            appVersion: rejectedVersion,
            currentScreen: 'PARENT_CHORES',
            events: [],
          },
        }),
      ).rejects.toThrow(/value too long|check/i);
    }
  });

  it('limits stored diagnostic event timestamps to fifteen minutes inclusively', async () => {
    // Break caught: raw SQL stores an unbounded timeline despite the shared snapshot contract.
    const fixture = await createHouseholdFixture(database!);
    const snapshotWithLastEventAt = (at: string) => ({
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      currentScreen: 'PARENT_CHORES',
      events: [
        {
          kind: 'NETWORK',
          at: '2026-08-11T12:00:00.000Z',
          state: 'OFFLINE',
        },
        { kind: 'NETWORK', at, state: 'ONLINE' },
      ],
    });

    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: snapshotWithLastEventAt('2026-08-11T12:15:00.000Z'),
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insertFeedbackReport(fixture, {
        diagnosticSnapshot: snapshotWithLastEventAt('2026-08-11T12:15:00.001Z'),
      }),
    ).rejects.toThrow(/check/i);
  });

  it('enforces feedback lifecycle state pairings', async () => {
    // Break caught: status and reviewer/export/close metadata describing contradictory states.
    const fixture = await createHouseholdFixture(database!);
    const reviewedAt = new Date('2026-08-11T12:05:00.000Z');
    const terminalAt = new Date('2026-08-11T12:10:00.000Z');
    const updatedAt = new Date('2026-08-11T12:15:00.000Z');
    const reviewed = {
      reviewedByParentId: fixture.parentId,
      reviewedAt,
      updatedAt,
    };

    await expect(insertFeedbackReport(fixture)).resolves.toHaveLength(1);
    await expect(insertFeedbackReport(fixture, reviewed)).resolves.toHaveLength(
      1,
    );
    for (const status of ['REVIEWING', 'READY'] as const) {
      await expect(
        insertFeedbackReport(fixture, { ...reviewed, status }),
      ).resolves.toHaveLength(1);
    }
    await expect(
      insertFeedbackReport(fixture, {
        ...reviewed,
        exportedAt: terminalAt,
        status: 'EXPORTED',
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insertFeedbackReport(fixture, {
        ...reviewed,
        closedAt: terminalAt,
        publicIssueUrl: 'https://github.com/example/family/issues/1',
        status: 'CLOSED',
      }),
    ).resolves.toHaveLength(1);

    for (const overrides of [
      { reviewedByParentId: fixture.parentId },
      { reviewedAt },
      { status: 'REVIEWING' },
      { ...reviewed, status: 'EXPORTED' },
      { ...reviewed, exportedAt: terminalAt, status: 'READY' },
      { ...reviewed, status: 'CLOSED' },
      { ...reviewed, closedAt: terminalAt, status: 'EXPORTED' },
      {
        ...reviewed,
        closedAt: terminalAt,
        exportedAt: terminalAt,
        status: 'CLOSED',
      },
    ]) {
      await expect(insertFeedbackReport(fixture, overrides)).rejects.toThrow(
        /check/i,
      );
    }
  });

  it('enforces feedback lifecycle timestamp chronology', async () => {
    // Break caught: review/export/close metadata predating the report or occurring after its update.
    const fixture = await createHouseholdFixture(database!);
    const createdAt = new Date('2026-08-11T12:00:00.000Z');
    const reviewedAt = new Date('2026-08-11T12:05:00.000Z');
    const terminalAt = new Date('2026-08-11T12:10:00.000Z');
    const updatedAt = new Date('2026-08-11T12:15:00.000Z');

    for (const overrides of [
      {
        createdAt,
        updatedAt: new Date('2026-08-11T11:59:00.000Z'),
      },
      {
        createdAt,
        reviewedAt: new Date('2026-08-11T11:59:00.000Z'),
        reviewedByParentId: fixture.parentId,
        updatedAt,
      },
      {
        createdAt,
        reviewedAt,
        reviewedByParentId: fixture.parentId,
        exportedAt: new Date('2026-08-11T12:04:00.000Z'),
        status: 'EXPORTED',
        updatedAt,
      },
      {
        closedAt: new Date('2026-08-11T12:16:00.000Z'),
        createdAt,
        reviewedAt,
        reviewedByParentId: fixture.parentId,
        status: 'CLOSED',
        updatedAt,
      },
    ]) {
      await expect(insertFeedbackReport(fixture, overrides)).rejects.toThrow(
        /check/i,
      );
    }

    await expect(
      insertFeedbackReport(fixture, {
        closedAt: terminalAt,
        createdAt,
        reviewedAt,
        reviewedByParentId: fixture.parentId,
        status: 'CLOSED',
        updatedAt,
      }),
    ).resolves.toHaveLength(1);
  });

  it('declares household-scoped feedback identity and query indexes', async () => {
    // Break caught: later repositories losing scoped identity, queue ordering, or rate-limit lookup support.
    const uniqueConstraints = await database!.sql<
      { columns: string[]; name: string }[]
    >`
      SELECT
        constraint_definition.conname AS name,
        array_agg(attribute.attname ORDER BY key.ordinality) AS columns
      FROM pg_constraint AS constraint_definition
      CROSS JOIN LATERAL unnest(constraint_definition.conkey)
        WITH ORDINALITY AS key(attribute_number, ordinality)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_definition.conrelid
       AND attribute.attnum = key.attribute_number
      WHERE constraint_definition.conrelid = 'feedback_reports'::regclass
        AND constraint_definition.contype = 'u'
      GROUP BY constraint_definition.conname
      ORDER BY constraint_definition.conname
    `;
    const indexes = await database!.sql<{ indexdef: string; name: string }[]>`
      SELECT indexname AS name, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'feedback_reports'
      ORDER BY indexname
    `;

    expect(uniqueConstraints).toContainEqual({
      name: 'feedback_reports_household_id_unique',
      columns: ['household_id', 'id'],
    });
    expect(indexes).toContainEqual({
      name: 'feedback_reports_household_status_created_at_idx',
      indexdef: expect.stringMatching(/\(household_id, status, created_at\)$/),
    });
    expect(indexes).toContainEqual({
      name: 'feedback_reports_household_created_at_id_idx',
      indexdef: expect.stringMatching(
        /\(household_id, created_at DESC NULLS LAST, id DESC NULLS LAST\)$/,
      ),
    });
    expect(indexes).toContainEqual({
      name: 'feedback_reports_household_status_closed_at_idx',
      indexdef: expect.stringMatching(/\(household_id, status, closed_at\)$/),
    });
    expect(indexes).toContainEqual({
      name: 'feedback_reports_dashboard_actor_created_at_idx',
      indexdef: expect.stringMatching(
        /\(household_id, submitted_by_dashboard_device_id, created_at\)$/,
      ),
    });
  });

  it('deletes private feedback when its household is deleted', async () => {
    // Break caught: household deletion retaining private diagnostics or report text.
    const fixture = await createHouseholdFixture(database!);
    const [report] = await insertFeedbackReport(fixture);

    await database!.sql`
      DELETE FROM households
      WHERE id = ${fixture.householdId}
    `;

    await expect(
      database!.sql`
        SELECT id
        FROM feedback_reports
        WHERE household_id = ${fixture.householdId}
          AND id = ${report!.id}
      `,
    ).resolves.toEqual([]);
  });

  it('rejects duplicate idempotency keys within one household', async () => {
    const first = await createHouseholdFixture(database!);
    const idempotencyKey = randomUUID();

    await insertIdempotencyRecord(first, idempotencyKey);

    await expect(
      insertIdempotencyRecord(first, idempotencyKey),
    ).rejects.toThrow(/key/i);
  });

  it('rejects a second decision for the same submission attempt', async () => {
    const first = await createHouseholdFixture(database!);

    await insertApproval({ ...first, idempotencyKey: randomUUID() });

    await expect(
      insertApproval({ ...first, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/attempt/i);
  });

  it('rejects a decision that pairs an attempt with another chore', async () => {
    const fixture = await createHouseholdFixture(database!);
    const otherChoreInstanceId = await createChoreInstance(database!, fixture);
    const [attempt] = await database!.sql<{ id: string }[]>`
      INSERT INTO chore_submission_attempts (
        household_id,
        chore_instance_id,
        claimed_by_child_id,
        attempt_number,
        submitted_at
      )
      VALUES (
        ${fixture.householdId},
        ${fixture.choreInstanceId},
        ${fixture.childId},
        1,
        now()
      )
      RETURNING id
    `;

    await expect(
      database!.sql`
        INSERT INTO approval_decisions (
          household_id,
          chore_instance_id,
          submission_attempt_id,
          decided_by_parent_id,
          decision,
          idempotency_key
        )
        VALUES (
          ${fixture.householdId},
          ${otherChoreInstanceId},
          ${attempt!.id},
          ${fixture.parentId},
          'REJECTED',
          ${randomUUID()}
        )
      `,
    ).rejects.toThrow(/foreign key/i);
  });

  it('allows the same idempotency key in a different household', async () => {
    const first = await createHouseholdFixture(database!);
    const second = await createHouseholdFixture(database!);
    const idempotencyKey = randomUUID();

    await insertIdempotencyRecord(first, idempotencyKey);

    await expect(
      insertIdempotencyRecord(second, idempotencyKey),
    ).resolves.toBeDefined();
  });

  it('does not reapply an already recorded migration', async () => {
    const beforeReplay = await database!.sql.unsafe(
      'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
    );

    await runMigrations(database!.sql);

    const afterReplay = await database!.sql.unsafe(
      'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
    );

    expect(beforeReplay[0]?.count).toBeGreaterThan(0);
    expect(afterReplay).toEqual(beforeReplay);
  });

  it('preserves legacy null picture keys and round-trips new keyed chores', async () => {
    const preImageKeyMigrationDirectory =
      await createPreImageKeyMigrationDirectory();
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: preImageKeyMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(legacyDatabase);

      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();

      const [legacyTemplate] = await legacyDatabase.sql<
        { image_key: string | null }[]
      >`
        SELECT image_key
        FROM chore_templates
        WHERE id = ${fixture.choreTemplateId}
      `;
      const [legacyInstance] = await legacyDatabase.sql<
        { image_key: string | null }[]
      >`
        SELECT image_key
        FROM chore_instances
        WHERE id = ${fixture.choreInstanceId}
      `;

      const keyedTemplateId = randomUUID();
      const keyedInstanceId = randomUUID();
      const [keyedTemplate] = await legacyDatabase.sql<
        { image_key: string | null }[]
      >`
        INSERT INTO chore_templates (
          id,
          household_id,
          name,
          image_key,
          instructions,
          default_value_cents,
          default_duration_seconds
        )
        VALUES (
          ${keyedTemplateId},
          ${fixture.householdId},
          'Tidy toys',
          'tidy-toys',
          'Put every toy in its bin.',
          250,
          900
        )
        RETURNING image_key
      `;
      const [keyedInstance] = await legacyDatabase.sql<
        { image_key: string | null }[]
      >`
        INSERT INTO chore_instances (
          id,
          household_id,
          chore_template_id,
          name,
          image_key,
          instructions,
          value_cents,
          duration_seconds
        )
        VALUES (
          ${keyedInstanceId},
          ${fixture.householdId},
          ${keyedTemplateId},
          'Tidy toys',
          'tidy-toys',
          'Put every toy in its bin.',
          250,
          900
        )
        RETURNING image_key
      `;

      expect(legacyTemplate!.image_key).toBeNull();
      expect(legacyInstance!.image_key).toBeNull();
      expect(keyedTemplate!.image_key).toBe('tidy-toys');
      expect(keyedInstance!.image_key).toBe('tidy-toys');
    } finally {
      await legacyDatabase.stop();
      await rm(preImageKeyMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('excludes later migrations from the pre-image-key baseline', async () => {
    const preImageKeyMigrationDirectory =
      await createPreImageKeyMigrationDirectory(true);
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: preImageKeyMigrationDirectory,
    });

    try {
      const [sentinel] = await legacyDatabase.sql<
        { relationName: string | null }[]
      >`
        SELECT to_regclass(
          'public.synthetic_post_image_key_migration'
        )::text AS "relationName"
      `;

      expect(sentinel!.relationName).toBeNull();
    } finally {
      await legacyDatabase.stop();
      await rm(preImageKeyMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('upgrades the exact 5d5eb06 original core migration through HEAD', async () => {
    const originalCoreMigrationDirectory =
      await createOriginalCoreMigrationDirectory();
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: originalCoreMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(legacyDatabase);
      const parentKey = randomUUID();
      const dashboardKey = randomUUID();

      await legacyDatabase.sql`
        INSERT INTO idempotency_records (
          household_id,
          idempotency_key,
          actor_role,
          actor_id,
          operation,
          request_hash
        )
        VALUES
          (
            ${fixture.householdId},
            ${parentKey},
            'PARENT',
            ${fixture.parentId},
            'LEGACY_PARENT_OPERATION',
            'legacy-parent'
          ),
          (
            ${fixture.householdId},
            ${dashboardKey},
            'DASHBOARD',
            ${fixture.dashboardDeviceId},
            'LEGACY_DASHBOARD_OPERATION',
            'legacy-dashboard'
          )
      `;

      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();
      const [historyBeforeReplay] = await legacyDatabase.sql<
        { count: number }[]
      >`
        SELECT count(*)::int AS count
        FROM drizzle.__drizzle_migrations
      `;
      expect(historyBeforeReplay).toEqual({ count: 13 });
      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();
      const [historyAfterReplay] = await legacyDatabase.sql<
        { count: number }[]
      >`
        SELECT count(*)::int AS count
        FROM drizzle.__drizzle_migrations
      `;
      expect(historyAfterReplay).toEqual(historyBeforeReplay);

      const actorColumns = await legacyDatabase.sql<{ columnName: string }[]>`
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'idempotency_records'
          AND column_name IN (
            'actor_id',
            'actor_parent_id',
            'actor_dashboard_device_id'
          )
        ORDER BY column_name
      `;
      expect(actorColumns).toEqual([
        { columnName: 'actor_dashboard_device_id' },
        { columnName: 'actor_parent_id' },
      ]);

      const upgradedRecords = await legacyDatabase.sql<
        {
          actorDashboardDeviceId: string | null;
          actorParentId: string | null;
          idempotencyKey: string;
        }[]
      >`
        SELECT
          idempotency_key AS "idempotencyKey",
          actor_parent_id AS "actorParentId",
          actor_dashboard_device_id AS "actorDashboardDeviceId"
        FROM idempotency_records
        WHERE household_id = ${fixture.householdId}
        ORDER BY operation
      `;
      expect(upgradedRecords).toEqual([
        {
          idempotencyKey: dashboardKey,
          actorParentId: null,
          actorDashboardDeviceId: fixture.dashboardDeviceId,
        },
        {
          idempotencyKey: parentKey,
          actorParentId: fixture.parentId,
          actorDashboardDeviceId: null,
        },
      ]);

      await expect(
        legacyDatabase.sql`
          INSERT INTO chore_transitions (
            household_id,
            chore_instance_id,
            from_status,
            to_status,
            actor_role
          )
          VALUES (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AVAILABLE',
            'SYSTEM'
          )
        `,
      ).resolves.toBeDefined();

      await expect(
        legacyDatabase.sql`
          INSERT INTO idempotency_records (
            household_id,
            idempotency_key,
            actor_role,
            actor_parent_id,
            actor_dashboard_device_id,
            operation,
            request_hash
          )
          VALUES (
            ${fixture.householdId},
            ${randomUUID()},
            'PARENT',
            ${fixture.parentId},
            ${fixture.dashboardDeviceId},
            'INVALID_ACTOR_PAIR',
            'invalid'
          )
        `,
      ).rejects.toThrow(/check/i);
    } finally {
      await legacyDatabase.stop();
      await rm(originalCoreMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  }, 30_000);

  it('snapshots a household-scoped claimant on each submission attempt', async () => {
    const fixture = await createHouseholdFixture(database!);
    const other = await createHouseholdFixture(database!);
    const submissionAttemptId = randomUUID();

    await expect(
      database!.sql`
        INSERT INTO chore_submission_attempts (
          id,
          household_id,
          chore_instance_id,
          claimed_by_child_id,
          attempt_number,
          submitted_at
        )
        VALUES (
          ${submissionAttemptId},
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${fixture.childId},
          1,
          now()
        )
      `,
    ).resolves.toBeDefined();

    await expect(
      database!.sql`
        INSERT INTO chore_submission_attempts (
          household_id,
          chore_instance_id,
          claimed_by_child_id,
          attempt_number,
          submitted_at
        )
        VALUES (
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          NULL,
          2,
          now()
        )
      `,
    ).rejects.toThrow(/check/i);

    await expect(
      database!.sql`
        INSERT INTO chore_submission_attempts (
          household_id,
          chore_instance_id,
          claimed_by_child_id,
          attempt_number,
          submitted_at
        )
        VALUES (
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${other.childId},
          2,
          now()
        )
      `,
    ).rejects.toThrow(/foreign key/i);
  });

  it('requires one household-scoped chore credit per approval decision', async () => {
    const fixture = await createHouseholdFixture(database!);
    const submissionAttemptId = randomUUID();
    const decisionId = randomUUID();

    await database!.sql`
      INSERT INTO chore_submission_attempts (
        id,
        household_id,
        chore_instance_id,
        claimed_by_child_id,
        attempt_number,
        submitted_at
      )
      VALUES (
        ${submissionAttemptId},
        ${fixture.householdId},
        ${fixture.choreInstanceId},
        ${fixture.childId},
        1,
        now()
      )
    `;
    await database!.sql`
      INSERT INTO approval_decisions (
        id,
        household_id,
        chore_instance_id,
        submission_attempt_id,
        decided_by_parent_id,
        decision,
        payout_cents,
        idempotency_key
      )
      VALUES (
        ${decisionId},
        ${fixture.householdId},
        ${fixture.choreInstanceId},
        ${submissionAttemptId},
        ${fixture.parentId},
        'APPROVED',
        250,
        ${randomUUID()}
      )
    `;

    await expect(
      insertLinkedChoreCredit(database!, fixture, decisionId),
    ).resolves.toBeDefined();
    await expect(
      insertLinkedChoreCredit(database!, fixture, decisionId),
    ).rejects.toThrow(/unique/i);
    await expect(
      insertLinkedChoreCredit(database!, fixture, null),
    ).rejects.toThrow(/check/i);
  });

  it('backfills deterministic claimant snapshots and approval credit links', async () => {
    const preCreditLinkMigrationDirectory =
      await createPreCreditLinkMigrationDirectory();
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: preCreditLinkMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(legacyDatabase);
      const ambiguousFixture = await createHouseholdFixture(legacyDatabase);
      const submissionAttemptId = randomUUID();
      const ambiguousSubmissionAttemptId = randomUUID();
      const approvalDecisionId = randomUUID();
      const creditId = randomUUID();
      await legacyDatabase.sql`
        UPDATE chore_instances
        SET
          claimed_by_child_id = ${fixture.childId},
          status = 'APPROVED'
        WHERE household_id = ${fixture.householdId}
          AND id = ${fixture.choreInstanceId}
      `;
      await legacyDatabase.sql`
        INSERT INTO chore_submission_attempts (
          id,
          household_id,
          chore_instance_id,
          attempt_number,
          submitted_at
        )
        VALUES (
          ${submissionAttemptId},
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          1,
          now()
        )
      `;
      await legacyDatabase.sql`
        INSERT INTO approval_decisions (
          id,
          household_id,
          chore_instance_id,
          submission_attempt_id,
          decided_by_parent_id,
          decision,
          payout_cents,
          idempotency_key
        )
        VALUES (
          ${approvalDecisionId},
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${submissionAttemptId},
          ${fixture.parentId},
          'APPROVED',
          250,
          ${randomUUID()}
        )
      `;
      await legacyDatabase.sql`
        INSERT INTO ledger_transactions (
          id,
          household_id,
          child_id,
          amount_cents,
          type,
          note,
          actor_parent_id,
          related_chore_instance_id
        )
        VALUES (
          ${creditId},
          ${fixture.householdId},
          ${fixture.childId},
          250,
          'CHORE_CREDIT',
          'Legacy approval',
          ${fixture.parentId},
          ${fixture.choreInstanceId}
        )
      `;
      await legacyDatabase.sql`
        UPDATE chore_instances
        SET
          claimed_by_child_id = ${ambiguousFixture.childId},
          status = 'CLAIMED'
        WHERE household_id = ${ambiguousFixture.householdId}
          AND id = ${ambiguousFixture.choreInstanceId}
      `;
      await legacyDatabase.sql`
        INSERT INTO chore_submission_attempts (
          id,
          household_id,
          chore_instance_id,
          attempt_number,
          submitted_at
        )
        VALUES (
          ${ambiguousSubmissionAttemptId},
          ${ambiguousFixture.householdId},
          ${ambiguousFixture.choreInstanceId},
          1,
          now()
        )
      `;
      await legacyDatabase.sql`
        INSERT INTO approval_decisions (
          household_id,
          chore_instance_id,
          submission_attempt_id,
          decided_by_parent_id,
          decision,
          idempotency_key
        )
        VALUES (
          ${ambiguousFixture.householdId},
          ${ambiguousFixture.choreInstanceId},
          ${ambiguousSubmissionAttemptId},
          ${ambiguousFixture.parentId},
          'REJECTED',
          ${randomUUID()}
        )
      `;

      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();
      const [attempt] = await legacyDatabase.sql<
        { claimedByChildId: string | null }[]
      >`
        SELECT claimed_by_child_id AS "claimedByChildId"
        FROM chore_submission_attempts
        WHERE household_id = ${fixture.householdId}
          AND id = ${submissionAttemptId}
      `;
      const [credit] = await legacyDatabase.sql<
        { approvalDecisionId: string | null }[]
      >`
        SELECT approval_decision_id AS "approvalDecisionId"
        FROM ledger_transactions
        WHERE household_id = ${fixture.householdId}
          AND id = ${creditId}
      `;
      const [ambiguousAttempt] = await legacyDatabase.sql<
        { claimedByChildId: string | null }[]
      >`
        SELECT claimed_by_child_id AS "claimedByChildId"
        FROM chore_submission_attempts
        WHERE household_id = ${ambiguousFixture.householdId}
          AND id = ${ambiguousSubmissionAttemptId}
      `;

      expect(attempt).toEqual({ claimedByChildId: fixture.childId });
      expect(credit).toEqual({ approvalDecisionId });
      expect(ambiguousAttempt).toEqual({ claimedByChildId: null });
    } finally {
      await legacyDatabase.stop();
      await rm(preCreditLinkMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('upgrades transition attribution to allow unaffiliated SYSTEM events only', async () => {
    const preSystemMigrationDirectory =
      await createPreSystemMigrationDirectory();
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: preSystemMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(legacyDatabase);

      await expect(
        legacyDatabase.sql`
          INSERT INTO chore_transitions (
            household_id,
            chore_instance_id,
            from_status,
            to_status,
            actor_role
          )
          VALUES (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AVAILABLE',
            'SYSTEM'
          )
        `,
      ).rejects.toThrow(/enum/i);

      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();

      await expect(
        legacyDatabase.sql`
          INSERT INTO chore_transitions (
            household_id,
            chore_instance_id,
            from_status,
            to_status,
            actor_role
          )
          VALUES (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AVAILABLE',
            'SYSTEM'
          )
        `,
      ).resolves.toBeDefined();

      await expect(
        legacyDatabase.sql`
          INSERT INTO chore_transitions (
            household_id,
            chore_instance_id,
            from_status,
            to_status,
            actor_role,
            actor_parent_id
          )
          VALUES (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AVAILABLE',
            'SYSTEM',
            ${fixture.parentId}
          )
        `,
      ).rejects.toThrow(/check/i);

      await expect(
        legacyDatabase.sql`
          INSERT INTO chore_transitions (
            household_id,
            chore_instance_id,
            from_status,
            to_status,
            actor_role
          )
          VALUES (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AVAILABLE',
            'PARENT'
          )
        `,
      ).rejects.toThrow(/check/i);
    } finally {
      await legacyDatabase.stop();
      await rm(preSystemMigrationDirectory, { force: true, recursive: true });
    }
  });

  it('upgrades a legacy ledger enum with a forward migration', async () => {
    const legacyMigrationDirectory = await createLegacyMigrationDirectory();
    const legacyDatabase = await startTestDatabase({
      migrationsFolder: legacyMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(legacyDatabase);

      await expect(
        legacyDatabase.sql`
          INSERT INTO ledger_transactions (
            id,
            household_id,
            child_id,
            amount_cents,
            type,
            note,
            actor_parent_id
          )
          VALUES (
            ${randomUUID()},
            ${fixture.householdId},
            ${fixture.childId},
            100,
            'CORRECTION',
            'Legacy correction',
            ${fixture.parentId}
          )
        `,
      ).rejects.toThrow(/enum/i);

      await legacyDatabase.sql`
        INSERT INTO ledger_transactions (
          id,
          household_id,
          child_id,
          amount_cents,
          type,
          note,
          actor_parent_id
        )
        VALUES (
          ${randomUUID()},
          ${fixture.householdId},
          ${fixture.childId},
          100,
          'PURCHASE',
          'Legacy positive purchase',
          ${fixture.parentId}
        )
      `;

      await expect(runMigrations(legacyDatabase.sql)).resolves.toBeUndefined();

      await expect(
        legacyDatabase.sql<{ amountCents: number }[]>`
          SELECT amount_cents AS "amountCents"
          FROM ledger_transactions
          WHERE household_id = ${fixture.householdId}
            AND note = 'Legacy positive purchase'
        `,
      ).resolves.toEqual([{ amountCents: 100 }]);

      await expect(
        legacyDatabase.sql`
          INSERT INTO ledger_transactions (
            id,
            household_id,
            child_id,
            amount_cents,
            type,
            note,
            actor_parent_id
          )
          VALUES (
            ${randomUUID()},
            ${fixture.householdId},
            ${fixture.childId},
            100,
            'CORRECTION',
            'Migrated correction',
            ${fixture.parentId}
          )
        `,
      ).resolves.toBeDefined();

      await expect(
        legacyDatabase.sql`
          INSERT INTO ledger_transactions (
            id,
            household_id,
            child_id,
            amount_cents,
            type,
            note,
            actor_parent_id
          )
          VALUES (
            ${randomUUID()},
            ${fixture.householdId},
            ${fixture.childId},
            100,
            'PURCHASE',
            'Invalid purchase',
            ${fixture.parentId}
          )
        `,
      ).rejects.toThrow(/check/i);
    } finally {
      await legacyDatabase.stop();
      await rm(legacyMigrationDirectory, { force: true, recursive: true });
    }
  });

  it('upgrades an existing ledger to allow zero-cent chore credits', async () => {
    const preApprovalMigrationDirectory =
      await createPreApprovalMigrationDirectory();
    const preApprovalDatabase = await startTestDatabase({
      migrationsFolder: preApprovalMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(preApprovalDatabase);

      await expect(
        insertZeroCentChoreCredit(preApprovalDatabase, fixture),
      ).rejects.toThrow(/check/i);

      await expect(
        runMigrations(preApprovalDatabase.sql),
      ).resolves.toBeUndefined();
      const approvalDecisionId = randomUUID();
      const [approvalTarget] = await preApprovalDatabase.sql<
        { submissionAttemptId: string }[]
      >`
        SELECT id AS "submissionAttemptId"
        FROM chore_submission_attempts
        WHERE household_id = ${fixture.householdId}
          AND chore_instance_id = ${fixture.choreInstanceId}
        ORDER BY attempt_number DESC
        LIMIT 1
      `;
      await preApprovalDatabase.sql`
        INSERT INTO approval_decisions (
          id,
          household_id,
          chore_instance_id,
          submission_attempt_id,
          decided_by_parent_id,
          decision,
          payout_cents,
          idempotency_key
        )
        VALUES (
          ${approvalDecisionId},
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${approvalTarget!.submissionAttemptId},
          ${fixture.parentId},
          'APPROVED',
          0,
          ${randomUUID()}
        )
      `;
      await expect(
        insertLinkedChoreCredit(
          preApprovalDatabase,
          fixture,
          approvalDecisionId,
          0,
        ),
      ).resolves.toBeDefined();
    } finally {
      await preApprovalDatabase.stop();
      await rm(preApprovalMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('repairs a conflated rejected attempt after original 0003 was applied', async () => {
    const preAttemptMigrationDirectory =
      await createPreAttemptMigrationDirectory();
    const attemptMigrationDirectory = await createAttemptMigrationDirectory();
    const preAttemptDatabase = await startTestDatabase({
      migrationsFolder: preAttemptMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(preAttemptDatabase);
      const pendingWithoutDecision =
        await createHouseholdFixture(preAttemptDatabase);
      const rejectedWithoutResubmission =
        await createHouseholdFixture(preAttemptDatabase);
      const availableWithoutDecision =
        await createHouseholdFixture(preAttemptDatabase);
      const decisionId = randomUUID();
      const firstSubmittedAt = '2026-08-08T14:00:00.000Z';
      const rejectedAt = '2026-08-08T14:05:00.000Z';
      const reclaimedAt = '2026-08-08T14:10:00.000Z';
      const currentSubmittedAt = '2026-08-08T14:15:00.000Z';

      await preAttemptDatabase.sql`
        UPDATE chore_instances
        SET
          claimed_by_child_id = ${fixture.childId},
          submitted_at = ${currentSubmittedAt}
        WHERE household_id = ${fixture.householdId}
          AND id = ${fixture.choreInstanceId}
      `;
      await preAttemptDatabase.sql`
        UPDATE chore_instances
        SET status = 'AVAILABLE'
        WHERE household_id IN (
          ${rejectedWithoutResubmission.householdId},
          ${availableWithoutDecision.householdId}
        )
      `;
      await preAttemptDatabase.sql`
        INSERT INTO approval_decisions (
          id,
          household_id,
          chore_instance_id,
          decided_by_parent_id,
          decision,
          payout_cents,
          idempotency_key,
          created_at
        )
        VALUES (
          ${decisionId},
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${fixture.parentId},
          'REJECTED',
          NULL,
          ${randomUUID()},
          ${rejectedAt}
        )
      `;
      await preAttemptDatabase.sql`
        INSERT INTO approval_decisions (
          household_id,
          chore_instance_id,
          decided_by_parent_id,
          decision,
          payout_cents,
          idempotency_key,
          created_at
        )
        VALUES (
          ${rejectedWithoutResubmission.householdId},
          ${rejectedWithoutResubmission.choreInstanceId},
          ${rejectedWithoutResubmission.parentId},
          'REJECTED',
          NULL,
          ${randomUUID()},
          ${rejectedAt}
        )
      `;
      await preAttemptDatabase.sql`
        INSERT INTO chore_transitions (
          household_id,
          chore_instance_id,
          from_status,
          to_status,
          actor_role,
          actor_parent_id,
          actor_dashboard_device_id,
          created_at
        )
        VALUES
          (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AWAITING_APPROVAL',
            'DASHBOARD',
            NULL,
            ${fixture.dashboardDeviceId},
            ${firstSubmittedAt}
          ),
          (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'AWAITING_APPROVAL',
            'AVAILABLE',
            'PARENT',
            ${fixture.parentId},
            NULL,
            ${rejectedAt}
          ),
          (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'AVAILABLE',
            'CLAIMED',
            'DASHBOARD',
            NULL,
            ${fixture.dashboardDeviceId},
            ${reclaimedAt}
          ),
          (
            ${fixture.householdId},
            ${fixture.choreInstanceId},
            'CLAIMED',
            'AWAITING_APPROVAL',
            'DASHBOARD',
            NULL,
            ${fixture.dashboardDeviceId},
            ${currentSubmittedAt}
          )
      `;

      await expect(
        runMigrations(preAttemptDatabase.sql, attemptMigrationDirectory),
      ).resolves.toBeUndefined();
      const conflatedAttempts = await preAttemptDatabase.sql<
        {
          attemptNumber: number;
          decision: 'APPROVED' | 'REJECTED' | null;
          decisionId: string | null;
          submittedAt: string;
        }[]
      >`
        SELECT
          chore_submission_attempts.attempt_number AS "attemptNumber",
          to_char(
            chore_submission_attempts.submitted_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) AS "submittedAt",
          approval_decisions.id AS "decisionId",
          approval_decisions.decision
        FROM chore_submission_attempts
        LEFT JOIN approval_decisions
          ON approval_decisions.household_id = chore_submission_attempts.household_id
          AND approval_decisions.submission_attempt_id = chore_submission_attempts.id
        WHERE chore_submission_attempts.household_id = ${fixture.householdId}
          AND chore_submission_attempts.chore_instance_id = ${fixture.choreInstanceId}
        ORDER BY chore_submission_attempts.attempt_number
      `;
      expect(conflatedAttempts).toEqual([
        {
          attemptNumber: 1,
          submittedAt: currentSubmittedAt,
          decisionId,
          decision: 'REJECTED',
        },
      ]);
      const readOrdinaryStateAttemptCounts = async () => {
        const counts = await preAttemptDatabase.sql<
          { choreInstanceId: string; count: number }[]
        >`
          SELECT
            chore_instances.id AS "choreInstanceId",
            count(chore_submission_attempts.id)::int AS count
          FROM chore_instances
          LEFT JOIN chore_submission_attempts
            ON chore_submission_attempts.household_id = chore_instances.household_id
            AND chore_submission_attempts.chore_instance_id = chore_instances.id
          WHERE chore_instances.id IN (
            ${pendingWithoutDecision.choreInstanceId},
            ${rejectedWithoutResubmission.choreInstanceId},
            ${availableWithoutDecision.choreInstanceId}
          )
          GROUP BY chore_instances.id
          ORDER BY chore_instances.id
        `;

        return Object.fromEntries(
          counts.map(({ choreInstanceId, count }) => [choreInstanceId, count]),
        );
      };
      const ordinaryStateCounts = {
        [pendingWithoutDecision.choreInstanceId]: 1,
        [rejectedWithoutResubmission.choreInstanceId]: 1,
        [availableWithoutDecision.choreInstanceId]: 0,
      };
      await expect(readOrdinaryStateAttemptCounts()).resolves.toEqual(
        ordinaryStateCounts,
      );

      await expect(
        runMigrations(preAttemptDatabase.sql),
      ).resolves.toBeUndefined();
      const repairedAttempts = await preAttemptDatabase.sql<
        {
          attemptNumber: number;
          decision: 'APPROVED' | 'REJECTED' | null;
          decisionId: string | null;
          submittedAt: string;
        }[]
      >`
        SELECT
          chore_submission_attempts.attempt_number AS "attemptNumber",
          to_char(
            chore_submission_attempts.submitted_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) AS "submittedAt",
          approval_decisions.id AS "decisionId",
          approval_decisions.decision
        FROM chore_submission_attempts
        LEFT JOIN approval_decisions
          ON approval_decisions.household_id = chore_submission_attempts.household_id
          AND approval_decisions.submission_attempt_id = chore_submission_attempts.id
        WHERE chore_submission_attempts.household_id = ${fixture.householdId}
          AND chore_submission_attempts.chore_instance_id = ${fixture.choreInstanceId}
        ORDER BY chore_submission_attempts.attempt_number
      `;
      expect(repairedAttempts).toEqual([
        {
          attemptNumber: 1,
          submittedAt: currentSubmittedAt,
          decisionId,
          decision: 'REJECTED',
        },
        {
          attemptNumber: 2,
          submittedAt: currentSubmittedAt,
          decisionId: null,
          decision: null,
        },
      ]);
      await expect(readOrdinaryStateAttemptCounts()).resolves.toEqual(
        ordinaryStateCounts,
      );

      const repairMigration = await readFile(
        new URL(
          '../../../db/migrations/0004_repair-conflated-chore-submissions.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await preAttemptDatabase.sql.unsafe(repairMigration);
      const [{ attemptCount }] = await preAttemptDatabase.sql<
        { attemptCount: number }[]
      >`
        SELECT count(*)::int AS "attemptCount"
        FROM chore_submission_attempts
        WHERE household_id = ${fixture.householdId}
          AND chore_instance_id = ${fixture.choreInstanceId}
      `;
      expect(attemptCount).toBe(2);
      await expect(readOrdinaryStateAttemptCounts()).resolves.toEqual(
        ordinaryStateCounts,
      );

      const service = new ChoreService(preAttemptDatabase.database, {
        now: () => new Date('2026-08-08T14:20:00.000Z'),
      });
      const [approvalTarget] = await preAttemptDatabase.sql<
        { submissionAttemptId: string }[]
      >`
        SELECT id AS "submissionAttemptId"
        FROM chore_submission_attempts
        WHERE household_id = ${fixture.householdId}
          AND chore_instance_id = ${fixture.choreInstanceId}
          AND attempt_number = 2
      `;
      const approved = await service.approve(
        {
          role: 'PARENT',
          actorId: fixture.parentId,
          householdId: fixture.householdId,
        },
        {
          choreInstanceId: fixture.choreInstanceId,
          submissionAttemptId: approvalTarget!.submissionAttemptId,
          idempotencyKey: randomUUID(),
          payoutCents: 275,
          note: 'Approved after migration',
        },
      );
      expect(approved.status).toBe('APPROVED');

      const decisionsAfterApproval = await preAttemptDatabase.sql<
        {
          attemptNumber: number;
          decision: 'APPROVED' | 'REJECTED';
          decisionId: string;
          payoutCents: number | null;
        }[]
      >`
        SELECT
          chore_submission_attempts.attempt_number AS "attemptNumber",
          approval_decisions.id AS "decisionId",
          approval_decisions.decision,
          approval_decisions.payout_cents AS "payoutCents"
        FROM approval_decisions
        INNER JOIN chore_submission_attempts
          ON chore_submission_attempts.household_id = approval_decisions.household_id
          AND chore_submission_attempts.id = approval_decisions.submission_attempt_id
        WHERE approval_decisions.household_id = ${fixture.householdId}
          AND approval_decisions.chore_instance_id = ${fixture.choreInstanceId}
        ORDER BY chore_submission_attempts.attempt_number
      `;
      expect(decisionsAfterApproval).toEqual([
        {
          attemptNumber: 1,
          decisionId,
          decision: 'REJECTED',
          payoutCents: null,
        },
        {
          attemptNumber: 2,
          decisionId: expect.any(String),
          decision: 'APPROVED',
          payoutCents: 275,
        },
      ]);
      const [finalState] = await preAttemptDatabase.sql<
        { creditCount: number; status: string }[]
      >`
        SELECT
          chore_instances.status,
          count(ledger_transactions.id)::int AS "creditCount"
        FROM chore_instances
        LEFT JOIN ledger_transactions
          ON ledger_transactions.household_id = chore_instances.household_id
          AND ledger_transactions.related_chore_instance_id = chore_instances.id
          AND ledger_transactions.type = 'CHORE_CREDIT'
        WHERE chore_instances.household_id = ${fixture.householdId}
          AND chore_instances.id = ${fixture.choreInstanceId}
        GROUP BY chore_instances.id
      `;
      expect(finalState).toEqual({ status: 'APPROVED', creditCount: 1 });
    } finally {
      await preAttemptDatabase.stop();
      await rm(preAttemptMigrationDirectory, {
        force: true,
        recursive: true,
      });
      await rm(attemptMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('repairs conflated attempts in the full pending migration sequence', async () => {
    const preAttemptMigrationDirectory =
      await createPreAttemptMigrationDirectory();
    const freshSequenceDatabase = await startTestDatabase({
      migrationsFolder: preAttemptMigrationDirectory,
    });

    try {
      const fixture = await createHouseholdFixture(freshSequenceDatabase);
      await freshSequenceDatabase.sql`
        UPDATE chore_instances
        SET
          claimed_by_child_id = ${fixture.childId},
          submitted_at = '2026-08-08T16:00:00.000Z'
        WHERE household_id = ${fixture.householdId}
          AND id = ${fixture.choreInstanceId}
      `;
      await freshSequenceDatabase.sql`
        INSERT INTO approval_decisions (
          household_id,
          chore_instance_id,
          decided_by_parent_id,
          decision,
          idempotency_key,
          created_at
        )
        VALUES (
          ${fixture.householdId},
          ${fixture.choreInstanceId},
          ${fixture.parentId},
          'REJECTED',
          ${randomUUID()},
          '2026-08-08T15:00:00.000Z'
        )
      `;

      await expect(
        runMigrations(freshSequenceDatabase.sql),
      ).resolves.toBeUndefined();
      const [migrationHistory] = await freshSequenceDatabase.sql<
        { count: number }[]
      >`
        SELECT count(*)::int AS count
        FROM drizzle.__drizzle_migrations
      `;
      expect(migrationHistory).toEqual({ count: 13 });
      const attempts = await freshSequenceDatabase.sql<
        { attemptNumber: number; decision: 'REJECTED' | null }[]
      >`
        SELECT
          chore_submission_attempts.attempt_number AS "attemptNumber",
          approval_decisions.decision
        FROM chore_submission_attempts
        LEFT JOIN approval_decisions
          ON approval_decisions.household_id = chore_submission_attempts.household_id
          AND approval_decisions.submission_attempt_id = chore_submission_attempts.id
        WHERE chore_submission_attempts.household_id = ${fixture.householdId}
          AND chore_submission_attempts.chore_instance_id = ${fixture.choreInstanceId}
        ORDER BY chore_submission_attempts.attempt_number
      `;
      expect(attempts).toEqual([
        { attemptNumber: 1, decision: 'REJECTED' },
        { attemptNumber: 2, decision: null },
      ]);
    } finally {
      await freshSequenceDatabase.stop();
      await rm(preAttemptMigrationDirectory, {
        force: true,
        recursive: true,
      });
    }
  });

  it('rejects cross-household and contradictory actor attribution', async () => {
    const first = await createHouseholdFixture(database!);
    const second = await createHouseholdFixture(database!);

    await expect(
      database!.sql`
        INSERT INTO chore_transitions (
          id,
          household_id,
          chore_instance_id,
          from_status,
          to_status,
          actor_role,
          actor_parent_id
        )
        VALUES (
          ${randomUUID()},
          ${first.householdId},
          ${first.choreInstanceId},
          'AVAILABLE',
          'CLAIMED',
          'PARENT',
          ${second.parentId}
        )
      `,
    ).rejects.toThrow(/foreign key/i);

    await expect(
      database!.sql`
        INSERT INTO chore_transitions (
          id,
          household_id,
          chore_instance_id,
          from_status,
          to_status,
          actor_role,
          actor_parent_id
        )
        VALUES (
          ${randomUUID()},
          ${first.householdId},
          ${first.choreInstanceId},
          'AVAILABLE',
          'CLAIMED',
          'DASHBOARD',
          ${first.parentId}
        )
      `,
    ).rejects.toThrow(/check/i);

    await expect(
      database!.sql`
        INSERT INTO audit_events (
          id,
          household_id,
          actor_role,
          actor_parent_id,
          actor_dashboard_device_id,
          event_type,
          entity_type,
          entity_id,
          payload
        )
        VALUES (
          ${randomUUID()},
          ${first.householdId},
          'PARENT',
          ${first.parentId},
          ${first.dashboardDeviceId},
          'CHORE_CREATED',
          'CHORE_INSTANCE',
          ${first.choreInstanceId},
          ${JSON.stringify({})}::jsonb
        )
      `,
    ).rejects.toThrow(/check/i);

    await expect(
      database!.sql`
        INSERT INTO idempotency_records (
          id,
          household_id,
          idempotency_key,
          actor_role,
          actor_parent_id,
          operation,
          request_hash
        )
        VALUES (
          ${randomUUID()},
          ${first.householdId},
          ${randomUUID()},
          'DASHBOARD',
          ${first.parentId},
          'APPROVE_CHORE',
          'test-request'
        )
      `,
    ).rejects.toThrow(/check/i);
  });
});

async function createHouseholdFixture(
  database: TestDatabase,
): Promise<HouseholdFixture> {
  const householdId = randomUUID();
  const parentId = randomUUID();
  const dashboardDeviceId = randomUUID();
  const childId = randomUUID();
  const templateId = randomUUID();
  const choreInstanceId = randomUUID();

  await database.sql`
    INSERT INTO households (id, name, time_zone)
    VALUES (${householdId}, 'Test household', 'America/New_York')
  `;
  await database.sql`
    INSERT INTO parent_memberships (id, household_id, parent_id)
    VALUES (${randomUUID()}, ${householdId}, ${parentId})
  `;
  await database.sql`
    INSERT INTO dashboard_devices (id, household_id, name)
    VALUES (${dashboardDeviceId}, ${householdId}, 'Kitchen dashboard')
  `;
  await database.sql`
    INSERT INTO child_profiles (id, household_id, name, color)
    VALUES (${childId}, ${householdId}, 'Test child', 'blue')
  `;
  await database.sql`
    INSERT INTO chore_templates (
      id,
      household_id,
      name,
      instructions,
      default_value_cents,
      default_duration_seconds
    )
    VALUES (
      ${templateId},
      ${householdId},
      'Wash dishes',
      'Wash and dry all dishes.',
      250,
      900
    )
  `;
  await database.sql`
    INSERT INTO chore_instances (
      id,
      household_id,
      chore_template_id,
      name,
      instructions,
      value_cents,
      duration_seconds,
      status
    )
    VALUES (
      ${choreInstanceId},
      ${householdId},
      ${templateId},
      'Wash dishes',
      'Wash and dry all dishes.',
      250,
      900,
      'AWAITING_APPROVAL'
    )
  `;

  return {
    childId,
    householdId,
    parentId,
    dashboardDeviceId,
    choreTemplateId: templateId,
    choreInstanceId,
  };
}

async function createLegacyMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-ledger-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  await copyFile(
    join(sourceMigrationDirectory, '0000_core.sql'),
    join(migrationDirectory, '0000_core.sql'),
  );
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_225_391_687,
          tag: '0000_core',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function createPreImageKeyMigrationDirectory(
  includeSyntheticLaterMigration = false,
): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-pre-image-key-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );
  const journal = JSON.parse(
    await readFile(
      join(sourceMigrationDirectory, 'meta', '_journal.json'),
      'utf8',
    ),
  ) as {
    dialect: string;
    entries: {
      breakpoints: boolean;
      idx: number;
      tag: string;
      version: string;
      when: number;
    }[];
    version: string;
  };
  const journalWithSyntheticMigration = includeSyntheticLaterMigration
    ? {
        ...journal,
        entries: [
          ...journal.entries,
          {
            idx: 10,
            version: '7',
            when: 1_786_325_200_000,
            tag: '0010_synthetic-later',
            breakpoints: true,
          },
        ],
      }
    : journal;
  const entries = journalWithSyntheticMigration.entries.filter(
    ({ idx }) => idx < 9,
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  for (const { tag } of entries) {
    if (tag === '0010_synthetic-later') {
      await writeFile(
        join(migrationDirectory, `${tag}.sql`),
        'CREATE TABLE synthetic_post_image_key_migration (id integer);',
      );
      continue;
    }
    await copyFile(
      join(sourceMigrationDirectory, `${tag}.sql`),
      join(migrationDirectory, `${tag}.sql`),
    );
  }
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({ ...journalWithSyntheticMigration, entries }),
  );

  return migrationDirectory;
}

async function createOriginalCoreMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-original-core-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const originalCoreMigration = await readFile(
    new URL('./fixtures/migrations/5d5eb06-0000_core.sql', import.meta.url),
    'utf8',
  );
  expect(createHash('sha256').update(originalCoreMigration).digest('hex')).toBe(
    'c518b17b0244f828e0840e2fa043ca9b5b790ec7738d5c324deaa3bd5d90e475',
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  await writeFile(
    join(migrationDirectory, '0000_core.sql'),
    originalCoreMigration,
  );
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_225_391_687,
          tag: '0000_core',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function createPreCreditLinkMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-pre-credit-link-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );
  const journal = JSON.parse(
    await readFile(
      join(sourceMigrationDirectory, 'meta', '_journal.json'),
      'utf8',
    ),
  ) as {
    dialect: string;
    entries: {
      breakpoints: boolean;
      idx: number;
      tag: string;
      version: string;
      when: number;
    }[];
    version: string;
  };
  const entries = journal.entries.filter(({ idx }) => idx < 8);

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  for (const { tag } of entries) {
    await copyFile(
      join(sourceMigrationDirectory, `${tag}.sql`),
      join(migrationDirectory, `${tag}.sql`),
    );
  }
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );

  return migrationDirectory;
}

async function createPreApprovalMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-approval-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  await copyFile(
    join(sourceMigrationDirectory, '0000_core.sql'),
    join(migrationDirectory, '0000_core.sql'),
  );
  await copyFile(
    join(sourceMigrationDirectory, '0001_ledger-entry-categories.sql'),
    join(migrationDirectory, '0001_ledger-entry-categories.sql'),
  );
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_226_401_191,
          tag: '0000_core',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 1_786_229_656_685,
          tag: '0001_ledger-entry-categories',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function createPreAttemptMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-attempt-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  for (const migration of [
    '0000_core.sql',
    '0001_ledger-entry-categories.sql',
    '0002_allow-zero-chore-credit.sql',
  ]) {
    await copyFile(
      join(sourceMigrationDirectory, migration),
      join(migrationDirectory, migration),
    );
  }
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_226_401_191,
          tag: '0000_core',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 1_786_229_656_685,
          tag: '0001_ledger-entry-categories',
          breakpoints: true,
        },
        {
          idx: 2,
          version: '7',
          when: 1_786_230_892_663,
          tag: '0002_allow-zero-chore-credit',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function createAttemptMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-original-attempt-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  for (const migration of [
    '0000_core.sql',
    '0001_ledger-entry-categories.sql',
    '0002_allow-zero-chore-credit.sql',
    '0003_chore-submission-attempts.sql',
  ]) {
    await copyFile(
      join(sourceMigrationDirectory, migration),
      join(migrationDirectory, migration),
    );
  }
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_226_401_191,
          tag: '0000_core',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 1_786_229_656_685,
          tag: '0001_ledger-entry-categories',
          breakpoints: true,
        },
        {
          idx: 2,
          version: '7',
          when: 1_786_230_892_663,
          tag: '0002_allow-zero-chore-credit',
          breakpoints: true,
        },
        {
          idx: 3,
          version: '7',
          when: 1_786_248_135_860,
          tag: '0003_chore-submission-attempts',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function createPreSystemMigrationDirectory(): Promise<string> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-system-actor-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const sourceMigrationDirectory = fileURLToPath(
    new URL('../../../db/migrations/', import.meta.url),
  );
  const migrations = [
    '0000_core.sql',
    '0001_ledger-entry-categories.sql',
    '0002_allow-zero-chore-credit.sql',
    '0003_chore-submission-attempts.sql',
    '0004_repair-conflated-chore-submissions.sql',
  ];

  await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
  for (const migration of migrations) {
    await copyFile(
      join(sourceMigrationDirectory, migration),
      join(migrationDirectory, migration),
    );
  }
  await writeFile(
    join(migrationDirectory, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1_786_226_401_191,
          tag: '0000_core',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 1_786_229_656_685,
          tag: '0001_ledger-entry-categories',
          breakpoints: true,
        },
        {
          idx: 2,
          version: '7',
          when: 1_786_230_892_663,
          tag: '0002_allow-zero-chore-credit',
          breakpoints: true,
        },
        {
          idx: 3,
          version: '7',
          when: 1_786_248_135_860,
          tag: '0003_chore-submission-attempts',
          breakpoints: true,
        },
        {
          idx: 4,
          version: '7',
          when: 1_786_249_597_358,
          tag: '0004_repair-conflated-chore-submissions',
          breakpoints: true,
        },
      ],
    }),
  );

  return migrationDirectory;
}

async function insertZeroCentChoreCredit(
  database: TestDatabase,
  fixture: HouseholdFixture,
) {
  return database.sql`
    INSERT INTO ledger_transactions (
      id,
      household_id,
      child_id,
      amount_cents,
      type,
      note,
      actor_parent_id,
      related_chore_instance_id
    )
    VALUES (
      ${randomUUID()},
      ${fixture.householdId},
      ${fixture.childId},
      0,
      'CHORE_CREDIT',
      'Zero-cent approval',
      ${fixture.parentId},
      ${fixture.choreInstanceId}
    )
  `;
}

async function insertLinkedChoreCredit(
  database: TestDatabase,
  fixture: HouseholdFixture,
  approvalDecisionId: string | null,
  amountCents = 250,
) {
  return database.sql`
    INSERT INTO ledger_transactions (
      household_id,
      child_id,
      amount_cents,
      type,
      note,
      actor_parent_id,
      related_chore_instance_id,
      approval_decision_id
    )
    VALUES (
      ${fixture.householdId},
      ${fixture.childId},
      ${amountCents},
      'CHORE_CREDIT',
      'Approved chore',
      ${fixture.parentId},
      ${fixture.choreInstanceId},
      ${approvalDecisionId}
    )
  `;
}

async function createChoreInstance(
  database: TestDatabase,
  household: HouseholdFixture,
): Promise<string> {
  const choreInstanceId = randomUUID();

  await database.sql`
    INSERT INTO chore_instances (
      id,
      household_id,
      chore_template_id,
      name,
      instructions,
      value_cents,
      duration_seconds,
      status
    )
    VALUES (
      ${choreInstanceId},
      ${household.householdId},
      ${household.choreTemplateId},
      'Load dishwasher',
      'Load all dishes into the dishwasher.',
      250,
      900,
      'AWAITING_APPROVAL'
    )
  `;

  return choreInstanceId;
}
