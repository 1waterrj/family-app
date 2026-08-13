import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClientDiagnosticSnapshotSchema,
  type ClientDiagnosticSnapshot,
} from '@family/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  runMigrations,
  startTestDatabase,
  type TestDatabase,
} from './support/database.js';
import { createFixtures, type HouseholdFixture } from './support/fixtures.js';

const sourceMigrationDirectory = fileURLToPath(
  new URL('../../../db/migrations/', import.meta.url),
);
const createdAt = '2026-08-11T12:00:00.000Z';

describe('feedback 0010 to 0011 upgrade', () => {
  let database: TestDatabase;
  let fixture: HouseholdFixture;
  let temporaryMigrationRoot: string;

  beforeAll(async () => {
    const migrationDirectory = await createMigrationDirectoryThrough(10);
    temporaryMigrationRoot = dirname(migrationDirectory);
    database = await startTestDatabase({
      migrationsFolder: migrationDirectory,
    });
    fixture = await createFixtures(database.database).household();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
    if (temporaryMigrationRoot) {
      await rm(temporaryMigrationRoot, { force: true, recursive: true });
    }
  });

  it('privacy-safely repairs every 0010-legal row before adding 0011 checks', async () => {
    // Break caught: adding stricter checks directly makes a deployed 0010 database unupgradeable.
    const reviewedAt = '2026-08-11T12:05:00.000Z';
    const terminalAt = '2026-08-11T12:10:00.000Z';
    const updatedAt = '2026-08-11T12:15:00.000Z';
    const oversizedApiEvent = {
      kind: 'API_RESULT',
      at: createdAt,
      operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW',
      outcome: 'ERROR',
      status: 599,
      errorCode: 'UNSUPPORTED_MEDIA_TYPE',
      durationBucket: 'FIVE_SECONDS_OR_MORE',
      requestId: '11111111-1111-4111-8111-111111111111',
    };
    const legacyRows: LegacyFeedbackRow[] = [
      {
        title: 'diagnostic-arbitrary',
        diagnosticSnapshot: { secret: 'Bearer legacy-private-token' },
      },
      {
        title: 'diagnostic-metadata-mismatch',
        diagnosticSnapshot: validSnapshot({ source: 'DASHBOARD' }),
      },
      {
        title: 'diagnostic-app-version-length',
        diagnosticSnapshot: validSnapshot({ appVersion: 'v'.repeat(161) }),
      },
      {
        title: 'diagnostic-event-count',
        diagnosticSnapshot: validSnapshot({
          events: Array.from({ length: 101 }, () => ({
            kind: 'NETWORK',
            at: createdAt,
            state: 'ONLINE',
          })),
        }),
      },
      {
        title: 'diagnostic-event-bytes',
        diagnosticSnapshot: validSnapshot({
          events: Array.from({ length: 100 }, () => ({
            ...oversizedApiEvent,
          })),
        }),
      },
      {
        title: 'invalid-trusted-metadata',
        appVersion: '   ',
        screen: 'x'.repeat(64),
        diagnosticSnapshot: { responseBody: 'legacy private response' },
      },
      {
        title: 'reviewer-id-only',
        reviewedByParentId: fixture.parent.actorId,
        status: 'REVIEWING',
      },
      {
        title: 'reviewer-time-only',
        reviewedAt,
      },
      {
        title: 'new-terminal-metadata',
        closedAt: terminalAt,
        exportedAt: terminalAt,
      },
      {
        title: 'reviewing-terminal-metadata',
        closedAt: terminalAt,
        exportedAt: terminalAt,
        reviewedAt,
        reviewedByParentId: fixture.parent.actorId,
        status: 'REVIEWING',
        updatedAt,
      },
      { title: 'ready-no-reviewer', status: 'READY' },
      {
        title: 'exported-missing-export',
        closedAt: terminalAt,
        reviewedAt,
        reviewedByParentId: fixture.parent.actorId,
        status: 'EXPORTED',
        updatedAt,
      },
      {
        title: 'exported-no-reviewer',
        exportedAt: terminalAt,
        status: 'EXPORTED',
        updatedAt,
      },
      {
        title: 'closed-missing-close',
        exportedAt: terminalAt,
        reviewedAt,
        reviewedByParentId: fixture.parent.actorId,
        status: 'CLOSED',
        updatedAt,
      },
      {
        title: 'closed-no-reviewer',
        closedAt: terminalAt,
        status: 'CLOSED',
        updatedAt,
      },
      {
        title: 'updated-before-created',
        updatedAt: '2026-08-11T11:59:00.000Z',
      },
      {
        title: 'review-before-created',
        reviewedAt: '2026-08-11T11:59:00.000Z',
        reviewedByParentId: fixture.parent.actorId,
      },
      {
        title: 'export-before-review',
        exportedAt: '2026-08-11T12:01:00.000Z',
        reviewedAt,
        reviewedByParentId: fixture.parent.actorId,
        status: 'EXPORTED',
        updatedAt: '2026-08-11T12:02:00.000Z',
      },
      {
        title: 'close-before-review',
        closedAt: '2026-08-11T12:01:00.000Z',
        reviewedAt,
        reviewedByParentId: fixture.parent.actorId,
        status: 'CLOSED',
        updatedAt: '2026-08-11T12:02:00.000Z',
      },
      {
        title: 'review-after-update',
        reviewedAt: terminalAt,
        reviewedByParentId: fixture.parent.actorId,
        updatedAt: '2026-08-11T12:02:00.000Z',
      },
    ];

    for (const row of legacyRows) {
      await insertLegacyFeedback(database, fixture, row);
    }

    await expect(runMigrations(database.sql)).resolves.toBeUndefined();

    const repaired = await readFeedback(database);
    expect(repaired).toHaveLength(legacyRows.length);
    expect(JSON.stringify(repaired)).not.toContain('legacy-private-token');
    expect(JSON.stringify(repaired)).not.toContain('legacy private response');
    for (const row of repaired) {
      expect(
        ClientDiagnosticSnapshotSchema.safeParse(row.diagnosticSnapshot)
          .success,
        row.title,
      ).toBe(true);
      expect(row.diagnosticSnapshot).toMatchObject({
        source: row.source,
        appVersion: row.appVersion,
        currentScreen: row.screen,
      });
    }

    expect(
      rowNamed(repaired, 'diagnostic-arbitrary').diagnosticSnapshot,
    ).toEqual(validSnapshot());
    expect(
      rowNamed(repaired, 'diagnostic-event-bytes').diagnosticSnapshot.events,
    ).toEqual([]);
    expect(rowNamed(repaired, 'invalid-trusted-metadata')).toMatchObject({
      appVersion: 'development',
      screen: 'PARENT_HOME',
      diagnosticSnapshot: validSnapshot({
        appVersion: 'development',
        currentScreen: 'PARENT_HOME',
      }),
    });
    expect(rowNamed(repaired, 'reviewer-id-only')).toMatchObject({
      status: 'REVIEWING',
    });
    expect(
      timestampIso(rowNamed(repaired, 'reviewer-id-only').reviewedAt),
    ).toBe(createdAt);
    expect(rowNamed(repaired, 'reviewer-time-only')).toMatchObject({
      reviewedAt: null,
      reviewedByParentId: null,
      status: 'NEW',
    });
    expect(rowNamed(repaired, 'ready-no-reviewer')).toMatchObject({
      reviewedAt: null,
      status: 'NEW',
    });
    expect(rowNamed(repaired, 'exported-missing-export')).toMatchObject({
      closedAt: null,
      status: 'EXPORTED',
    });
    expect(
      timestampIso(rowNamed(repaired, 'exported-missing-export').exportedAt),
    ).toBe(reviewedAt);
    expect(rowNamed(repaired, 'closed-missing-close')).toMatchObject({
      exportedAt: null,
      status: 'CLOSED',
    });
    expect(
      timestampIso(rowNamed(repaired, 'closed-missing-close').closedAt),
    ).toBe(reviewedAt);
    expect(
      timestampIso(rowNamed(repaired, 'export-before-review').exportedAt),
    ).toBe(reviewedAt);
    expect(
      timestampIso(rowNamed(repaired, 'export-before-review').updatedAt),
    ).toBe(reviewedAt);
    expect(
      timestampIso(rowNamed(repaired, 'close-before-review').closedAt),
    ).toBe(reviewedAt);
    expect(
      timestampIso(rowNamed(repaired, 'close-before-review').updatedAt),
    ).toBe(reviewedAt);
    expect(
      timestampIso(rowNamed(repaired, 'updated-before-created').updatedAt),
    ).toBe(createdAt);
    expect(
      timestampIso(rowNamed(repaired, 'review-after-update').updatedAt),
    ).toBe(terminalAt);
  }, 60_000);
});

describe('feedback 0011 to 0012 admission upgrade', () => {
  let database: TestDatabase;
  let fixture: HouseholdFixture;
  let temporaryMigrationRoot: string;

  beforeAll(async () => {
    const migrationDirectory = await createMigrationDirectoryThrough(11);
    temporaryMigrationRoot = dirname(migrationDirectory);
    database = await startTestDatabase({
      migrationsFolder: migrationDirectory,
    });
    fixture = await createFixtures(database.database).household();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
    if (temporaryMigrationRoot) {
      await rm(temporaryMigrationRoot, { force: true, recursive: true });
    }
  });

  it('privacy-safely repairs formerly legal versions and over-wide timelines before enforcing 0012', async () => {
    // Break caught: stricter admission either blocks deployed upgrades or retains unsafe public metadata/history.
    await insertLegacyFeedback(database, fixture, {
      title: 'unsafe-version',
      appVersion: 'unknown',
      diagnosticSnapshot: validSnapshot({ appVersion: 'unknown' }),
    });
    await insertLegacyFeedback(database, fixture, {
      title: 'wide-timeline',
      diagnosticSnapshot: validSnapshot({
        events: [
          networkEvent('2026-08-11T12:00:00.000Z'),
          networkEvent('2026-08-11T12:15:00.001Z'),
        ],
      }),
    });

    await expect(runMigrations(database.sql)).resolves.toBeUndefined();

    const repaired = await readFeedback(database);
    expect(rowNamed(repaired, 'unsafe-version')).toMatchObject({
      appVersion: 'development',
      diagnosticSnapshot: validSnapshot({ appVersion: 'development' }),
    });
    expect(
      rowNamed(repaired, 'wide-timeline').diagnosticSnapshot.events,
    ).toEqual([]);
    for (const row of repaired) {
      expect(
        ClientDiagnosticSnapshotSchema.safeParse(row.diagnosticSnapshot)
          .success,
        row.title,
      ).toBe(true);
    }
  }, 60_000);
});

describe('feedback diagnostic SQL and contract parity', () => {
  let database: TestDatabase;
  let fixture: HouseholdFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    fixture = await createFixtures(database.database).household();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  });

  it.each([
    ['minute precision', networkEvent('2026-08-11T23:59Z'), true],
    [
      'fractional seconds',
      networkEvent('2026-08-11T23:59:59.123456789Z'),
      true,
    ],
    ['leap day', networkEvent('2024-02-29T00:00:00Z'), true],
    ['year zero', networkEvent('0000-01-01T00:00:00Z'), true],
    ['hour 24', networkEvent('2026-08-11T24:00:00Z'), false],
    ['non-leap February 29', networkEvent('2026-02-29T00:00:00Z'), false],
    ['April 31', networkEvent('2026-04-31T00:00:00Z'), false],
    ['minute 60', networkEvent('2026-08-11T23:60:00Z'), false],
    ['second 60', networkEvent('2026-08-11T23:59:60Z'), false],
    ['fraction without seconds', networkEvent('2026-08-11T23:59.1Z'), false],
    ['offset time', networkEvent('2026-08-11T23:59:00+00:00'), false],
    ['lowercase date separators', networkEvent('2026-08-11t23:59:00z'), false],
    ['null request UUID', apiEvent(null), true],
    [
      'nil request UUID',
      apiEvent('00000000-0000-0000-0000-000000000000'),
      true,
    ],
    [
      'max request UUID',
      apiEvent('ffffffff-ffff-ffff-ffff-ffffffffffff'),
      true,
    ],
    [
      'uppercase max request UUID',
      apiEvent('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'),
      false,
    ],
    [
      'mixed-case max request UUID',
      apiEvent('fFffffff-ffff-ffff-ffff-ffffffffffff'),
      false,
    ],
    [
      'ordinary mixed-case request UUID',
      apiEvent('A1111111-B111-4111-8ABC-111111111111'),
      true,
    ],
    [
      'version 1 request UUID',
      apiEvent('11111111-1111-1111-8111-111111111111'),
      true,
    ],
    [
      'version 8 request UUID',
      apiEvent('11111111-1111-8111-b111-111111111111'),
      true,
    ],
    [
      'version 0 request UUID',
      apiEvent('11111111-1111-0111-8111-111111111111'),
      false,
    ],
    [
      'version 9 request UUID',
      apiEvent('11111111-1111-9111-8111-111111111111'),
      false,
    ],
    [
      'invalid request UUID variant',
      apiEvent('11111111-1111-4111-7111-111111111111'),
      false,
    ],
  ] as const)(
    'matches ClientDiagnosticSnapshotSchema for %s',
    async (_case, event, contractAccepts) => {
      // Break caught: hand-written SQL timestamp/UUID validation drifting from Zod.
      const snapshot = validSnapshot({ events: [event] });
      expect(ClientDiagnosticSnapshotSchema.safeParse(snapshot).success).toBe(
        contractAccepts,
      );

      const insert = insertCurrentFeedback(database, fixture, snapshot);
      if (contractAccepts) {
        await expect(insert).resolves.toHaveLength(1);
      } else {
        await expect(insert).rejects.toThrow(/check/i);
      }
    },
  );

  it.each([
    ['development version', validSnapshot({ appVersion: 'development' }), true],
    [
      'semver build version',
      validSnapshot({ appVersion: '1.2.3-beta.1+build.42' }),
      true,
    ],
    [
      'alphanumeric prerelease version',
      validSnapshot({ appVersion: '1.2.3-01alpha' }),
      true,
    ],
    [
      'leading-zero numeric prerelease version',
      validSnapshot({ appVersion: '1.2.3-01' }),
      false,
    ],
    [
      'credential-shaped SemVer build',
      validSnapshot({ appVersion: '1.2.3+AKIAIOSFODNN7EXAMPLE' }),
      true,
    ],
    [
      'known-term-shaped SemVer build',
      validSnapshot({ appVersion: '1.2.3+Avery' }),
      true,
    ],
    [
      'JWT-shaped SemVer build',
      validSnapshot({
        appVersion:
          '1.2.3+eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYW1pbHkifQ.c2lnbmF0dXJl',
      }),
      true,
    ],
    [
      'Markdown-shaped SemVer build',
      validSnapshot({ appVersion: '1.2.3+build](https://example.test)' }),
      false,
    ],
    [
      'control-bearing SemVer build',
      validSnapshot({ appVersion: '1.2.3+build\u0007secret' }),
      false,
    ],
    [
      'leading version whitespace',
      validSnapshot({ appVersion: ' 1.2.3' }),
      false,
    ],
    [
      'version URL',
      validSnapshot({ appVersion: 'https://family.example/app/1.2.3' }),
      false,
    ],
    [
      'credential-like version',
      validSnapshot({ appVersion: 'Bearer private-token' }),
      false,
    ],
    [
      'version prose',
      validSnapshot({ appVersion: 'the version from the test phone' }),
      false,
    ],
    [
      'fifteen-minute boundary',
      validSnapshot({
        events: [
          networkEvent('2026-08-11T12:15:00.000Z'),
          networkEvent('2026-08-11T12:00:00.000Z'),
        ],
      }),
      true,
    ],
    [
      'outside fifteen-minute window',
      validSnapshot({
        events: [
          networkEvent('2026-08-11T12:15:00.001Z'),
          networkEvent('2026-08-11T12:00:00.000Z'),
        ],
      }),
      false,
    ],
    [
      'one nanosecond outside fifteen-minute window',
      validSnapshot({
        events: [
          networkEvent('2026-08-11T12:00:00.000Z'),
          networkEvent('2026-08-11T12:15:00.000000001Z'),
        ],
      }),
      false,
    ],
  ] as const)(
    'matches snapshot admission between Zod and PostgreSQL for %s',
    async (_case, candidate, accepted) => {
      // Break caught: runtime and migration SQL disagree on public version safety or incident-window duration.
      expect(ClientDiagnosticSnapshotSchema.safeParse(candidate).success).toBe(
        accepted,
      );
      const insert = insertCurrentFeedback(
        database,
        fixture,
        candidate as ClientDiagnosticSnapshot,
      );
      if (accepted) {
        await expect(insert).resolves.toHaveLength(1);
      } else {
        await expect(insert).rejects.toThrow(/check/i);
      }
    },
  );
});

interface LegacyFeedbackRow {
  appVersion?: string;
  closedAt?: string | null;
  diagnosticSnapshot?: unknown;
  exportedAt?: string | null;
  reviewedAt?: string | null;
  reviewedByParentId?: string | null;
  screen?: string;
  status?: 'NEW' | 'REVIEWING' | 'READY' | 'EXPORTED' | 'CLOSED';
  title: string;
  updatedAt?: string;
}

interface StoredFeedbackRow {
  appVersion: string;
  closedAt: Date | string | null;
  diagnosticSnapshot: ClientDiagnosticSnapshot;
  exportedAt: Date | string | null;
  reviewedAt: Date | string | null;
  reviewedByParentId: string | null;
  screen: string;
  source: string;
  status: string;
  title: string;
  updatedAt: Date | string;
}

function validSnapshot(
  overrides: Partial<ClientDiagnosticSnapshot> = {},
): ClientDiagnosticSnapshot {
  return {
    source: 'PARENT_IOS',
    appVersion: '1.2.3',
    currentScreen: 'PARENT_CHORES',
    events: [],
    ...overrides,
  };
}

function networkEvent(at: string) {
  return { kind: 'NETWORK' as const, at, state: 'ONLINE' as const };
}

function apiEvent(requestId: string | null) {
  return {
    kind: 'API_RESULT' as const,
    at: createdAt,
    operation: 'CREATE_FEEDBACK' as const,
    outcome: 'SUCCESS' as const,
    status: 201,
    errorCode: null,
    durationBucket: 'UNDER_250_MS' as const,
    requestId,
  };
}

async function insertLegacyFeedback(
  database: TestDatabase,
  fixture: HouseholdFixture,
  row: LegacyFeedbackRow,
) {
  const appVersion = row.appVersion ?? '1.2.3';
  const screen = row.screen ?? 'PARENT_CHORES';
  return database.sql`
    INSERT INTO feedback_reports (
      household_id,
      submitted_by_role,
      submitted_by_parent_id,
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
      exported_at,
      closed_at,
      created_at,
      updated_at
    )
    VALUES (
      ${fixture.household.id},
      'PARENT',
      ${fixture.parent.actorId},
      'BROKEN',
      ${row.title},
      'Legacy private feedback.',
      'PARENT_IOS',
      ${appVersion},
      ${screen},
      ${JSON.stringify(
        row.diagnosticSnapshot ??
          validSnapshot({ appVersion, currentScreen: screen as never }),
      )}::jsonb,
      ${row.status ?? 'NEW'},
      ${row.reviewedByParentId ?? null},
      ${row.reviewedAt ?? null},
      ${row.exportedAt ?? null},
      ${row.closedAt ?? null},
      ${createdAt},
      ${row.updatedAt ?? createdAt}
    )
  `;
}

function insertCurrentFeedback(
  database: TestDatabase,
  fixture: HouseholdFixture,
  diagnosticSnapshot: ClientDiagnosticSnapshot,
) {
  return database.sql`
    INSERT INTO feedback_reports (
      household_id,
      submitted_by_role,
      submitted_by_parent_id,
      category,
      title,
      description,
      source,
      app_version,
      screen,
      diagnostic_snapshot
    )
    VALUES (
      ${fixture.household.id},
      'PARENT',
      ${fixture.parent.actorId},
      'BROKEN',
      'Diagnostic parity case',
      'Compare PostgreSQL validation with the TypeScript contract.',
      ${diagnosticSnapshot.source},
      ${diagnosticSnapshot.appVersion},
      ${diagnosticSnapshot.currentScreen},
      ${JSON.stringify(diagnosticSnapshot)}::jsonb
    )
    RETURNING id
  `;
}

async function readFeedback(database: TestDatabase) {
  return database.sql<StoredFeedbackRow[]>`
    SELECT
      title,
      source::text AS source,
      app_version AS "appVersion",
      screen,
      diagnostic_snapshot AS "diagnosticSnapshot",
      status::text AS status,
      reviewed_by_parent_id AS "reviewedByParentId",
      reviewed_at AS "reviewedAt",
      exported_at AS "exportedAt",
      closed_at AS "closedAt",
      updated_at AS "updatedAt"
    FROM feedback_reports
    ORDER BY title
  `;
}

function rowNamed(rows: StoredFeedbackRow[], title: string) {
  const row = rows.find((candidate) => candidate.title === title);
  expect(row, title).toBeDefined();
  return row!;
}

function timestampIso(value: Date | string | null) {
  expect(value).not.toBeNull();
  return new Date(value!).toISOString();
}

async function createMigrationDirectoryThrough(lastIndex: number) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'family-feedback-upgrade-migrations-'),
  );
  const migrationDirectory = join(temporaryDirectory, 'migrations');
  const journal = JSON.parse(
    await readFile(
      join(sourceMigrationDirectory, 'meta', '_journal.json'),
      'utf8',
    ),
  ) as MigrationJournal;
  const entries = journal.entries.filter(({ idx }) => idx <= lastIndex);

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

interface MigrationJournal {
  dialect: string;
  entries: {
    breakpoints: boolean;
    idx: number;
    tag: string;
    version: string;
    when: number;
  }[];
  version: string;
}
