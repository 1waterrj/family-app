import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DevelopmentActorAuthenticator } from '../src/auth/actor-context.js';
import {
  type CredentialFileOperations,
  DEVELOPMENT_HOUSEHOLD_ID,
  seedDevelopmentHousehold,
} from '../src/dev/seed.js';
import {
  childProfiles,
  choreInstances,
  choreTemplates,
  dashboardDevices,
  feedbackReports,
  households,
  ledgerTransactions,
  parentMemberships,
} from '../src/db/schema.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

const developmentAuthSecret =
  'development-seed-test-secret-that-is-long-enough';
const firstSeedTime = new Date('2026-08-09T14:30:00.000Z');
const refreshedSeedTime = new Date('2026-08-10T15:45:00.000Z');
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const seedScript = join(repositoryRoot, 'scripts/dev-seed.sh');

describe('development household seed', () => {
  let testDatabase: TestDatabase;
  let temporaryRoot: string;

  beforeAll(async () => {
    testDatabase = await startTestDatabase();
    temporaryRoot = await mkdtemp(join(tmpdir(), 'family-development-seed-'));
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
    await testDatabase.stop();
  });

  it('refreshes only the reserved household with stable fixture rows and owner-only credentials', async () => {
    // Break caught: a refresh that appends rows, changes fixture identities,
    // deletes user data, emits a token, or writes readable credentials.
    const unrelatedHouseholdId = '11111111-1111-4111-8111-111111111111';
    const unrelatedParentId = '11111111-1111-4111-8111-111111111112';
    await testDatabase.database.insert(households).values({
      id: unrelatedHouseholdId,
      name: 'Do not replace',
      timeZone: 'America/Chicago',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await testDatabase.database.insert(parentMemberships).values({
      householdId: unrelatedHouseholdId,
      parentId: unrelatedParentId,
    });

    const outputDirectory = join(temporaryRoot, 'credentials');
    const capturedOutput: string[] = [];
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation((...values: unknown[]) => {
        capturedOutput.push(values.join(' '));
      });

    try {
      const first = await seedDevelopmentHousehold({
        database: testDatabase.database,
        developmentAuthSecret,
        parentApiOrigin: 'http://127.0.0.1:3000/',
        dashboardApiOrigin: 'http://127.0.0.1:4173/',
        outputDirectory,
        now: firstSeedTime,
      });
      await testDatabase.database.insert(feedbackReports).values([
        {
          householdId: DEVELOPMENT_HOUSEHOLD_ID,
          submittedByRole: 'PARENT',
          submittedByParentId: first.parentId,
          category: 'BROKEN',
          title: 'Fixture feedback',
          description: 'This report should be removed by fixture refresh.',
          source: 'PARENT_IOS',
          appVersion: '1.2.3',
          screen: 'PARENT_FEEDBACK',
          diagnosticSnapshot: {
            source: 'PARENT_IOS',
            appVersion: '1.2.3',
            currentScreen: 'PARENT_FEEDBACK',
            events: [],
          },
        },
        {
          householdId: unrelatedHouseholdId,
          submittedByRole: 'PARENT',
          submittedByParentId: unrelatedParentId,
          category: 'IDEA',
          title: 'Unrelated feedback',
          description: 'This report belongs to another household.',
          source: 'PARENT_ANDROID',
          appVersion: '4.5.6',
          screen: 'PARENT_FEEDBACK',
          diagnosticSnapshot: {
            source: 'PARENT_ANDROID',
            appVersion: '4.5.6',
            currentScreen: 'PARENT_FEEDBACK',
            events: [],
          },
        },
      ]);
      const second = await seedDevelopmentHousehold({
        database: testDatabase.database,
        developmentAuthSecret,
        parentApiOrigin: 'http://127.0.0.1:3000/',
        dashboardApiOrigin: 'http://127.0.0.1:4173/',
        outputDirectory,
        now: refreshedSeedTime,
      });

      expect(second).toEqual(first);
      expect(second).toEqual({
        householdId: '00000000-0000-4000-8000-000000000101',
        parentId: '00000000-0000-4000-8000-000000000102',
        dashboardId: '00000000-0000-4000-8000-000000000103',
        primaryChildId: '00000000-0000-4000-8000-000000000104',
        secondaryChildId: '00000000-0000-4000-8000-000000000105',
        parentCredentialPath: join(outputDirectory, 'parent.json'),
        dashboardCredentialPath: join(outputDirectory, 'dashboard.json'),
      });

      const [
        seededHouseholds,
        children,
        parents,
        dashboards,
        templates,
        chores,
        ledger,
      ] = await Promise.all([
        testDatabase.database
          .select()
          .from(households)
          .where(eq(households.id, DEVELOPMENT_HOUSEHOLD_ID)),
        testDatabase.database
          .select()
          .from(childProfiles)
          .where(eq(childProfiles.householdId, DEVELOPMENT_HOUSEHOLD_ID))
          .orderBy(childProfiles.id),
        testDatabase.database
          .select()
          .from(parentMemberships)
          .where(eq(parentMemberships.householdId, DEVELOPMENT_HOUSEHOLD_ID)),
        testDatabase.database
          .select()
          .from(dashboardDevices)
          .where(eq(dashboardDevices.householdId, DEVELOPMENT_HOUSEHOLD_ID)),
        testDatabase.database
          .select()
          .from(choreTemplates)
          .where(eq(choreTemplates.householdId, DEVELOPMENT_HOUSEHOLD_ID))
          .orderBy(choreTemplates.id),
        testDatabase.database
          .select()
          .from(choreInstances)
          .where(eq(choreInstances.householdId, DEVELOPMENT_HOUSEHOLD_ID))
          .orderBy(choreInstances.id),
        testDatabase.database
          .select()
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.householdId, DEVELOPMENT_HOUSEHOLD_ID))
          .orderBy(ledgerTransactions.id),
      ]);

      expect({
        households: seededHouseholds.length,
        children: children.length,
        parents: parents.length,
        dashboards: dashboards.length,
        templates: templates.length,
        availableChores: chores.filter(({ status }) => status === 'AVAILABLE')
          .length,
        ledgerTransactions: ledger.length,
      }).toEqual({
        households: 1,
        children: 2,
        parents: 1,
        dashboards: 1,
        templates: 8,
        availableChores: 4,
        ledgerTransactions: 2,
      });
      expect(seededHouseholds[0]).toMatchObject({
        name: 'Example Family',
        timeZone: 'America/New_York',
        createdAt: refreshedSeedTime,
      });
      expect(
        children.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
      ).toEqual([
        {
          id: '00000000-0000-4000-8000-000000000104',
          name: 'Avery',
          createdAt: refreshedSeedTime,
        },
        {
          id: '00000000-0000-4000-8000-000000000105',
          name: 'Riley',
          createdAt: refreshedSeedTime,
        },
      ]);
      expect(new Set(children.map(({ color }) => color)).size).toBe(2);
      expect(parents[0]).toMatchObject({
        id: '00000000-0000-4000-8000-000000000106',
        parentId: second.parentId,
        createdAt: refreshedSeedTime,
      });
      expect(dashboards[0]).toMatchObject({
        id: second.dashboardId,
        name: 'Kitchen dashboard',
        createdAt: refreshedSeedTime,
      });
      expect(
        templates.map(({ id, imageKey, createdAt }) => ({
          id,
          imageKey,
          createdAt,
        })),
      ).toEqual(
        [
          ['00000000-0000-4000-8000-000000000111', 'tidy-toys'],
          ['00000000-0000-4000-8000-000000000112', 'dishes'],
          ['00000000-0000-4000-8000-000000000113', 'set-table'],
          ['00000000-0000-4000-8000-000000000114', 'laundry'],
          ['00000000-0000-4000-8000-000000000115', 'feed-pet'],
          ['00000000-0000-4000-8000-000000000116', 'make-bed'],
          ['00000000-0000-4000-8000-000000000117', 'wipe-counter'],
          ['00000000-0000-4000-8000-000000000118', 'help-garden'],
        ].map(([id, imageKey]) => ({
          id,
          imageKey,
          createdAt: refreshedSeedTime,
        })),
      );
      expect(
        chores.map(({ id, choreTemplateId, status, createdAt }) => ({
          id,
          choreTemplateId,
          status,
          createdAt,
        })),
      ).toEqual([
        {
          id: '00000000-0000-4000-8000-000000000121',
          choreTemplateId: '00000000-0000-4000-8000-000000000111',
          status: 'AVAILABLE',
          createdAt: refreshedSeedTime,
        },
        {
          id: '00000000-0000-4000-8000-000000000122',
          choreTemplateId: '00000000-0000-4000-8000-000000000112',
          status: 'AVAILABLE',
          createdAt: refreshedSeedTime,
        },
        {
          id: '00000000-0000-4000-8000-000000000123',
          choreTemplateId: '00000000-0000-4000-8000-000000000113',
          status: 'AVAILABLE',
          createdAt: refreshedSeedTime,
        },
        {
          id: '00000000-0000-4000-8000-000000000124',
          choreTemplateId: '00000000-0000-4000-8000-000000000114',
          status: 'AVAILABLE',
          createdAt: refreshedSeedTime,
        },
      ]);
      expect(
        ledger.map(
          ({ id, childId, amountCents, type, actorParentId, createdAt }) => ({
            id,
            childId,
            amountCents,
            type,
            actorParentId,
            createdAt,
          }),
        ),
      ).toEqual([
        {
          id: '00000000-0000-4000-8000-000000000131',
          childId: second.primaryChildId,
          amountCents: 500,
          type: 'MANUAL_CREDIT',
          actorParentId: second.parentId,
          createdAt: refreshedSeedTime,
        },
        {
          id: '00000000-0000-4000-8000-000000000132',
          childId: second.secondaryChildId,
          amountCents: 300,
          type: 'MANUAL_CREDIT',
          actorParentId: second.parentId,
          createdAt: refreshedSeedTime,
        },
      ]);

      await expect(
        testDatabase.database
          .select()
          .from(households)
          .where(eq(households.id, unrelatedHouseholdId)),
      ).resolves.toEqual([
        expect.objectContaining({
          id: unrelatedHouseholdId,
          name: 'Do not replace',
        }),
      ]);
      await expect(
        testDatabase.database
          .select({ householdId: feedbackReports.householdId })
          .from(feedbackReports)
          .orderBy(feedbackReports.householdId),
      ).resolves.toEqual([{ householdId: unrelatedHouseholdId }]);

      const parentCredential = JSON.parse(
        await readFile(first.parentCredentialPath, 'utf8'),
      ) as Record<string, unknown>;
      const dashboardCredential = JSON.parse(
        await readFile(first.dashboardCredentialPath, 'utf8'),
      ) as Record<string, unknown>;
      expect(parentCredential).toEqual({
        version: 1,
        apiOrigin: 'http://127.0.0.1:3000',
        accessToken: expect.any(String),
      });
      expect(dashboardCredential).toEqual({
        version: 1,
        apiOrigin: 'http://127.0.0.1:4173',
        accessToken: expect.any(String),
      });

      const authenticator = new DevelopmentActorAuthenticator(
        developmentAuthSecret,
      );
      await expect(
        authenticator.authenticate(`Bearer ${parentCredential.accessToken}`),
      ).resolves.toEqual({
        role: 'PARENT',
        actorId: second.parentId,
        householdId: second.householdId,
      });
      await expect(
        authenticator.authenticate(`Bearer ${dashboardCredential.accessToken}`),
      ).resolves.toEqual({
        role: 'DASHBOARD',
        actorId: second.dashboardId,
        householdId: second.householdId,
      });

      const allOutput = capturedOutput.join('\n');
      expect(capturedOutput).toEqual(
        [first, second].flatMap((result) => [
          'Development household refreshed.',
          `Household: ${result.householdId}`,
          `Parent credential: ${result.parentCredentialPath}`,
          `Dashboard credential: ${result.dashboardCredentialPath}`,
        ]),
      );
      expect(allOutput).toContain('Development household refreshed.');
      expect(allOutput).not.toContain(String(parentCredential.accessToken));
      expect(allOutput).not.toContain(String(dashboardCredential.accessToken));
      expect((await stat(outputDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(first.parentCredentialPath)).mode & 0o777).toBe(0o600);
      expect((await stat(first.dashboardCredentialPath)).mode & 0o777).toBe(
        0o600,
      );
      await expect(readdir(outputDirectory)).resolves.toEqual([
        'dashboard.json',
        'parent.json',
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('refuses to seed in production before changing the database or filesystem', async () => {
    // Break caught: a production process reaching fixture deletion or token output.
    const outputDirectory = join(temporaryRoot, 'production-credentials');
    vi.stubEnv('NODE_ENV', 'production');

    try {
      await expect(
        seedDevelopmentHousehold({
          database: testDatabase.database,
          developmentAuthSecret,
          parentApiOrigin: 'http://127.0.0.1:3000',
          dashboardApiOrigin: 'http://127.0.0.1:3000',
          outputDirectory,
          now: new Date('2027-01-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(
        'Development household seed is disabled in production.',
      );
      await expect(stat(outputDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        testDatabase.database
          .select()
          .from(households)
          .where(eq(households.id, DEVELOPMENT_HOUSEHOLD_ID)),
      ).resolves.toEqual([
        expect.objectContaining({ createdAt: refreshedSeedTime }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['parent', 'https://example.com'],
    ['parent', 'http://fixture@127.0.0.1:3000'],
    ['parent', 'http://127.0.0.1:3000/v1'],
    ['dashboard', 'http://127.0.0.1:3000/?role=dashboard'],
    ['dashboard', 'http://192.168.1.999'],
  ] as const)(
    'rejects an unsafe %s origin before database or filesystem access',
    async (actor, unsafeOrigin) => {
      // Break caught: the server stripping unsafe URL components and creating a
      // fixture/credential that the shared client must reject.
      const outputDirectory = join(
        temporaryRoot,
        `unsafe-${actor}-${Math.random().toString(16).slice(2)}`,
      );
      const before = await testDatabase.database
        .select()
        .from(households)
        .where(eq(households.id, DEVELOPMENT_HOUSEHOLD_ID));

      await expect(
        seedDevelopmentHousehold({
          database: testDatabase.database,
          developmentAuthSecret,
          parentApiOrigin:
            actor === 'parent' ? unsafeOrigin : 'http://192.168.20.15:3000',
          dashboardApiOrigin:
            actor === 'dashboard' ? unsafeOrigin : 'http://127.0.0.1:5173',
          outputDirectory,
          now: new Date('2027-02-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow('must be a local development origin');

      await expect(stat(outputDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        testDatabase.database
          .select()
          .from(households)
          .where(eq(households.id, DEVELOPMENT_HOUSEHOLD_ID)),
      ).resolves.toEqual(before);
    },
  );

  it('rejects a symlinked credential path component without touching its target', async () => {
    // Break caught: mkdir/chmod/open following an attacker-controlled directory
    // symlink and placing credentials outside the requested local fixture tree.
    const externalTarget = join(temporaryRoot, 'external-credential-target');
    const safeParent = join(temporaryRoot, 'symlink-parent');
    const linkedComponent = join(safeParent, 'linked');
    await mkdir(externalTarget, { mode: 0o755 });
    await mkdir(safeParent, { mode: 0o700 });
    await symlink(externalTarget, linkedComponent, 'dir');

    await expect(
      seedDevelopmentHousehold({
        database: testDatabase.database,
        developmentAuthSecret,
        parentApiOrigin: 'http://192.168.20.15:3000',
        dashboardApiOrigin: 'http://127.0.0.1:5173',
        outputDirectory: join(linkedComponent, 'credentials'),
        now: new Date('2027-03-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('Credential output path cannot contain symbolic links.');

    await expect(readdir(externalTarget)).resolves.toEqual([]);
    expect((await stat(externalTarget)).mode & 0o777).toBe(0o755);
  });

  it.each(['open', 'rename'] as const)(
    'contains an ancestor-swap race at the credential %s boundary',
    async (raceBoundary) => {
      // Break caught: an attacker swapping a validated ancestor for a symlink
      // between pathname validation and open/rename, redirecting a token or
      // stranding a non-empty token-bearing temporary file.
      const raceRoot = join(temporaryRoot, `ancestor-race-${raceBoundary}`);
      const originalAncestor = join(raceRoot, 'original');
      const relocatedAncestor = join(raceRoot, 'relocated');
      const externalAncestor = join(raceRoot, 'external');
      const outputDirectory = join(originalAncestor, 'credentials');
      const externalCredentialDirectory = join(externalAncestor, 'credentials');
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      await mkdir(externalCredentialDirectory, {
        recursive: true,
        mode: 0o700,
      });

      await expect(
        seedDevelopmentHousehold({
          database: testDatabase.database,
          developmentAuthSecret,
          parentApiOrigin: 'http://192.168.20.15:3000',
          dashboardApiOrigin: 'http://127.0.0.1:5173',
          outputDirectory,
          now: new Date('2027-03-15T00:00:00.000Z'),
          fileOperations: ancestorSwapFileOperations({
            raceBoundary,
            originalAncestor,
            relocatedAncestor,
            externalAncestor,
          }),
        }),
      ).rejects.toThrow();

      await expect(readdir(externalCredentialDirectory)).resolves.toEqual([]);
      const relocatedCredentialDirectory = join(
        relocatedAncestor,
        'credentials',
      );
      const relocatedFiles = await readdir(relocatedCredentialDirectory);
      expect(relocatedFiles).not.toContain('parent.json');
      expect(relocatedFiles).not.toContain('dashboard.json');
      for (const file of relocatedFiles) {
        expect(file).toMatch(/\.tmp$/);
        expect(
          (await stat(join(relocatedCredentialDirectory, file))).size,
        ).toBe(0);
      }
    },
  );

  it.each(['write', 'close', 'rename'] as const)(
    'removes credential temporary files when %s fails',
    async (failure) => {
      // Break caught: a token-bearing sibling temporary file surviving any
      // failed atomic-write phase.
      const outputDirectory = join(temporaryRoot, `atomic-${failure}`);

      await expect(
        seedDevelopmentHousehold({
          database: testDatabase.database,
          developmentAuthSecret,
          parentApiOrigin: 'http://192.168.20.15:3000',
          dashboardApiOrigin: 'http://127.0.0.1:5173',
          outputDirectory,
          now: new Date('2027-04-01T00:00:00.000Z'),
          fileOperations: failingFileOperations(failure),
        }),
      ).rejects.toThrow(`Injected ${failure} failure.`);

      await expect(readdir(outputDirectory)).resolves.toEqual([]);
    },
  );

  it('surfaces cleanup failures after scrubbing the token-bearing temporary file', async () => {
    // Break caught: cleanup failures being silently swallowed after a rename
    // failure, leaving callers unaware of incomplete atomic-write handling.
    const outputDirectory = join(temporaryRoot, 'atomic-cleanup');

    await expect(
      seedDevelopmentHousehold({
        database: testDatabase.database,
        developmentAuthSecret,
        parentApiOrigin: 'http://192.168.20.15:3000',
        dashboardApiOrigin: 'http://127.0.0.1:5173',
        outputDirectory,
        now: new Date('2027-05-01T00:00:00.000Z'),
        fileOperations: failingFileOperations('rename-and-cleanup'),
      }),
    ).rejects.toThrow('Credential write failed and cleanup failed.');

    const remainingFiles = await readdir(outputDirectory);
    expect(remainingFiles).toHaveLength(1);
    expect(remainingFiles[0]).toMatch(/\.tmp$/);
    expect((await stat(join(outputDirectory, remainingFiles[0]!))).size).toBe(
      0,
    );
  });
});

describe('development seed command', () => {
  it('refuses production before invoking a build command', async () => {
    // Break caught: production reaching pnpm builds before the function-level
    // defense rejects fixture creation.
    const commandDirectory = join(temporaryCommandRoot, 'production-bin');
    const markerPath = join(temporaryCommandRoot, 'pnpm-invoked');
    await mkdir(commandDirectory, { recursive: true });
    const fakePnpm = join(commandDirectory, 'pnpm');
    await writeFile(
      fakePnpm,
      '#!/bin/sh\nprintf invoked > "$SEED_BUILD_MARKER"\n',
      'utf8',
    );
    await chmod(fakePnpm, 0o755);

    const result = await execFileAsync(seedScript, [], {
      cwd: repositoryRoot,
      env: {
        PATH: `${commandDirectory}:/usr/bin:/bin`,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://fixture',
        DEVELOPMENT_AUTH_SECRET: 'fixture-development-secret',
        DEV_PARENT_API_ORIGIN: 'http://192.168.20.15:3000',
        DEV_DASHBOARD_API_ORIGIN: 'http://127.0.0.1:5173',
        SEED_BUILD_MARKER: markerPath,
      },
    }).then(
      ({ stdout, stderr }) => ({ stdout, stderr }),
      (error: unknown) => error as { stdout: string; stderr: string },
    );

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Development household seed is disabled in production.',
    );
    await expect(stat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['DATABASE_URL', {}],
    ['DEVELOPMENT_AUTH_SECRET', { DATABASE_URL: 'postgres://fixture' }],
    [
      'DEV_PARENT_API_ORIGIN',
      {
        DATABASE_URL: 'postgres://fixture',
        DEVELOPMENT_AUTH_SECRET: 'fixture-development-secret',
      },
    ],
    [
      'DEV_DASHBOARD_API_ORIGIN',
      {
        DATABASE_URL: 'postgres://fixture',
        DEVELOPMENT_AUTH_SECRET: 'fixture-development-secret',
        DEV_PARENT_API_ORIGIN: 'http://127.0.0.1:3000',
      },
    ],
  ])(
    'refuses to run before building when %s is missing',
    async (name, values) => {
      // Break caught: a typo or missing local credential input being discovered
      // only after a build or database connection has already started.
      const result = await execFileAsync(seedScript, [], {
        cwd: repositoryRoot,
        env: { PATH: process.env.PATH, ...values },
      }).then(
        ({ stdout, stderr }) => ({ stdout, stderr }),
        (error: unknown) => error as { stdout: string; stderr: string },
      );

      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`${name} is required`);
      expect(result.stderr).not.toContain('fixture-development-secret');
    },
  );
});

let temporaryCommandRoot: string;

beforeAll(async () => {
  temporaryCommandRoot = await mkdtemp(
    join(tmpdir(), 'family-development-seed-command-'),
  );
});

afterAll(async () => {
  await rm(temporaryCommandRoot, { recursive: true, force: true });
});

function failingFileOperations(
  failure: 'write' | 'close' | 'rename' | 'rename-and-cleanup',
): CredentialFileOperations {
  let closeFailureInjected = false;

  return {
    mkdir,
    lstat,
    realpath,
    async open(path, flags, mode) {
      const handle = await open(path, flags, mode);
      let closeAttempted = false;

      return {
        chmod: (fileMode) => handle.chmod(fileMode),
        stat: () => handle.stat(),
        truncate: (length) => handle.truncate(length),
        async writeFile(data, encoding) {
          if (failure === 'write') throw new Error('Injected write failure.');
          await handle.writeFile(data, encoding);
        },
        sync: () => handle.sync(),
        async close() {
          if (failure === 'close' && !closeAttempted && !closeFailureInjected) {
            closeAttempted = true;
            closeFailureInjected = true;
            await handle.close();
            throw new Error('Injected close failure.');
          }
          if (!closeAttempted) {
            closeAttempted = true;
            await handle.close();
          }
        },
      };
    },
    async openDirectory(path, flags) {
      return open(path, flags);
    },
    async rename(from, to) {
      if (failure === 'rename' || failure === 'rename-and-cleanup') {
        throw new Error('Injected rename failure.');
      }
      await rename(from, to);
    },
    async unlink(path) {
      if (failure === 'rename-and-cleanup') {
        throw new Error('Injected cleanup failure.');
      }
      await unlink(path);
    },
  };
}

function ancestorSwapFileOperations(options: {
  raceBoundary: 'open' | 'rename';
  originalAncestor: string;
  relocatedAncestor: string;
  externalAncestor: string;
}): CredentialFileOperations {
  let swapped = false;

  const swapAncestor = async (): Promise<void> => {
    if (swapped) return;
    swapped = true;
    await rename(options.originalAncestor, options.relocatedAncestor);
    await symlink(options.externalAncestor, options.originalAncestor, 'dir');
  };

  return {
    mkdir,
    lstat,
    realpath,
    async open(path, flags, mode) {
      if (options.raceBoundary === 'open') await swapAncestor();
      return open(path, flags, mode);
    },
    openDirectory: (path, flags) => open(path, flags),
    async rename(from, to) {
      if (options.raceBoundary === 'rename') await swapAncestor();
      await rename(from, to);
    },
    unlink,
  };
}
