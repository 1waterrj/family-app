import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  type ChoreImageKey,
  normalizeLocalDevelopmentOrigin,
} from '@family/contracts';
import { eq } from 'drizzle-orm';

import { issueDevelopmentActorToken } from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import {
  auditEvents,
  childProfiles,
  choreInstances,
  choreTemplates,
  dashboardDevices,
  feedbackReports,
  households,
  ledgerTransactions,
  parentMemberships,
} from '../db/schema.js';

export const DEVELOPMENT_HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000101';

const parentId = '00000000-0000-4000-8000-000000000102';
const dashboardId = '00000000-0000-4000-8000-000000000103';
const primaryChildId = '00000000-0000-4000-8000-000000000104';
const secondaryChildId = '00000000-0000-4000-8000-000000000105';
const parentMembershipId = '00000000-0000-4000-8000-000000000106';

type TemplateFixture = {
  id: string;
  name: string;
  imageKey: ChoreImageKey;
  instructions: string;
  defaultValueCents: number;
  defaultDurationSeconds: number;
};

const templateFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000111',
    name: 'Tidy toys',
    imageKey: 'tidy-toys',
    instructions: 'Put the toys back in their homes.',
    defaultValueCents: 100,
    defaultDurationSeconds: 900,
  },
  {
    id: '00000000-0000-4000-8000-000000000112',
    name: 'Dishes',
    imageKey: 'dishes',
    instructions: 'Put the clean dishes away.',
    defaultValueCents: 150,
    defaultDurationSeconds: 1_200,
  },
  {
    id: '00000000-0000-4000-8000-000000000113',
    name: 'Set the table',
    imageKey: 'set-table',
    instructions: 'Set out plates, cups, and napkins.',
    defaultValueCents: 75,
    defaultDurationSeconds: 600,
  },
  {
    id: '00000000-0000-4000-8000-000000000114',
    name: 'Laundry',
    imageKey: 'laundry',
    instructions: 'Put the clean clothes in their drawers.',
    defaultValueCents: 200,
    defaultDurationSeconds: 1_800,
  },
  {
    id: '00000000-0000-4000-8000-000000000115',
    name: 'Feed a pet',
    imageKey: 'feed-pet',
    instructions: 'Fill the pet bowl with the right amount of food.',
    defaultValueCents: 50,
    defaultDurationSeconds: 300,
  },
  {
    id: '00000000-0000-4000-8000-000000000116',
    name: 'Make the bed',
    imageKey: 'make-bed',
    instructions: 'Pull up the covers and arrange the pillows.',
    defaultValueCents: 75,
    defaultDurationSeconds: 600,
  },
  {
    id: '00000000-0000-4000-8000-000000000117',
    name: 'Wipe a counter',
    imageKey: 'wipe-counter',
    instructions: 'Wipe crumbs and spots from the kitchen counter.',
    defaultValueCents: 100,
    defaultDurationSeconds: 600,
  },
  {
    id: '00000000-0000-4000-8000-000000000118',
    name: 'Help in the garden',
    imageKey: 'help-garden',
    instructions: 'Help water the plants that need a drink.',
    defaultValueCents: 150,
    defaultDurationSeconds: 1_200,
  },
] as const satisfies readonly TemplateFixture[];

const availableChoreFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000121',
    template: templateFixtures[0],
  },
  {
    id: '00000000-0000-4000-8000-000000000122',
    template: templateFixtures[1],
  },
  {
    id: '00000000-0000-4000-8000-000000000123',
    template: templateFixtures[2],
  },
  {
    id: '00000000-0000-4000-8000-000000000124',
    template: templateFixtures[3],
  },
] as const;

export type SeedDevelopmentHouseholdOptions = {
  database: Database;
  developmentAuthSecret: string;
  parentApiOrigin: string;
  dashboardApiOrigin: string;
  outputDirectory: string;
  now: Date;
  fileOperations?: CredentialFileOperations;
};

export type SeedDevelopmentHouseholdResult = {
  householdId: string;
  parentId: string;
  dashboardId: string;
  primaryChildId: string;
  secondaryChildId: string;
  parentCredentialPath: string;
  dashboardCredentialPath: string;
};

type DevelopmentCredential = {
  version: 1;
  apiOrigin: string;
  accessToken: string;
};

type FileIdentity = {
  dev: number;
  ino: number;
};

type CredentialFileHandle = {
  chmod(mode: number): Promise<void>;
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  stat(): Promise<FileIdentity>;
  truncate(length: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
};

type CredentialDirectoryHandle = {
  chmod(mode: number): Promise<void>;
  stat(): Promise<FileIdentity>;
  close(): Promise<void>;
};

type BoundCredentialDirectory = {
  physicalPath: string;
  identity: FileIdentity;
  handle: CredentialDirectoryHandle;
};

export type CredentialFileOperations = {
  mkdir(path: string, options: { mode: number }): Promise<unknown>;
  lstat(path: string): Promise<{
    dev: number;
    ino: number;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>;
  realpath(path: string): Promise<string>;
  open(
    path: string,
    flags: number,
    mode: number,
  ): Promise<CredentialFileHandle>;
  openDirectory(
    path: string,
    flags: number,
  ): Promise<CredentialDirectoryHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
};

const nodeCredentialFileOperations: CredentialFileOperations = {
  mkdir: (path, options) => mkdir(path, options),
  lstat,
  realpath,
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path, flags) => open(path, flags),
  rename,
  unlink,
};

export async function seedDevelopmentHousehold(
  options: SeedDevelopmentHouseholdOptions,
): Promise<SeedDevelopmentHouseholdResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development household seed is disabled in production.');
  }

  const parentApiOrigin = requireLocalDevelopmentOrigin(
    options.parentApiOrigin,
    'Parent API origin',
  );
  const dashboardApiOrigin = requireLocalDevelopmentOrigin(
    options.dashboardApiOrigin,
    'Dashboard API origin',
  );
  const fileOperations = options.fileOperations ?? nodeCredentialFileOperations;
  const credentialDirectory = await prepareCredentialDirectory(
    options.outputDirectory,
    fileOperations,
  );
  let operationError: unknown;
  let result: SeedDevelopmentHouseholdResult | undefined;

  try {
    result = await seedDevelopmentHouseholdInDirectory(
      options,
      parentApiOrigin,
      dashboardApiOrigin,
      credentialDirectory,
      fileOperations,
    );
  } catch (error) {
    operationError = error;
  }

  try {
    await credentialDirectory.handle.close();
  } catch (error) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, error],
        'Development seed failed and credential-directory cleanup failed.',
        { cause: error },
      );
    }
    throw error;
  }
  if (operationError !== undefined) throw operationError;
  return result!;
}

async function seedDevelopmentHouseholdInDirectory(
  options: SeedDevelopmentHouseholdOptions,
  parentApiOrigin: string,
  dashboardApiOrigin: string,
  credentialDirectory: BoundCredentialDirectory,
  fileOperations: CredentialFileOperations,
): Promise<SeedDevelopmentHouseholdResult> {
  const parentCredential = createCredential(
    parentApiOrigin,
    issueDevelopmentActorToken(
      {
        role: 'PARENT',
        actorId: parentId,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
      },
      options.developmentAuthSecret,
    ),
  );
  const dashboardCredential = createCredential(
    dashboardApiOrigin,
    issueDevelopmentActorToken(
      {
        role: 'DASHBOARD',
        actorId: dashboardId,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
      },
      options.developmentAuthSecret,
    ),
  );

  await refreshDatabase(options.database, options.now);

  const parentCredentialPath = join(options.outputDirectory, 'parent.json');
  const dashboardCredentialPath = join(
    options.outputDirectory,
    'dashboard.json',
  );
  await writeCredentialAtomically(
    credentialDirectory,
    'parent.json',
    parentCredential,
    fileOperations,
  );
  await writeCredentialAtomically(
    credentialDirectory,
    'dashboard.json',
    dashboardCredential,
    fileOperations,
  );

  console.log('Development household refreshed.');
  console.log(`Household: ${DEVELOPMENT_HOUSEHOLD_ID}`);
  console.log(`Parent credential: ${parentCredentialPath}`);
  console.log(`Dashboard credential: ${dashboardCredentialPath}`);

  return {
    householdId: DEVELOPMENT_HOUSEHOLD_ID,
    parentId,
    dashboardId,
    primaryChildId,
    secondaryChildId,
    parentCredentialPath,
    dashboardCredentialPath,
  };
}

async function refreshDatabase(database: Database, now: Date): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .delete(feedbackReports)
      .where(eq(feedbackReports.householdId, DEVELOPMENT_HOUSEHOLD_ID));
    await transaction
      .delete(ledgerTransactions)
      .where(eq(ledgerTransactions.householdId, DEVELOPMENT_HOUSEHOLD_ID));
    await transaction
      .delete(auditEvents)
      .where(eq(auditEvents.householdId, DEVELOPMENT_HOUSEHOLD_ID));
    await transaction
      .delete(households)
      .where(eq(households.id, DEVELOPMENT_HOUSEHOLD_ID));

    await transaction.insert(households).values({
      id: DEVELOPMENT_HOUSEHOLD_ID,
      name: 'Example Family',
      timeZone: 'America/New_York',
      createdAt: now,
    });
    await transaction.insert(parentMemberships).values({
      id: parentMembershipId,
      householdId: DEVELOPMENT_HOUSEHOLD_ID,
      parentId,
      createdAt: now,
    });
    await transaction.insert(dashboardDevices).values({
      id: dashboardId,
      householdId: DEVELOPMENT_HOUSEHOLD_ID,
      name: 'Kitchen dashboard',
      createdAt: now,
    });
    await transaction.insert(childProfiles).values([
      {
        id: primaryChildId,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        name: 'Avery',
        color: '#E11D48',
        createdAt: now,
      },
      {
        id: secondaryChildId,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        name: 'Riley',
        color: '#2563EB',
        createdAt: now,
      },
    ]);
    await transaction.insert(choreTemplates).values(
      templateFixtures.map((template) => ({
        ...template,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        createdByParentId: parentId,
        createdAt: now,
      })),
    );
    await transaction.insert(choreInstances).values(
      availableChoreFixtures.map(({ id, template }) => ({
        id,
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        choreTemplateId: template.id,
        name: template.name,
        imageKey: template.imageKey,
        instructions: template.instructions,
        valueCents: template.defaultValueCents,
        durationSeconds: template.defaultDurationSeconds,
        status: 'AVAILABLE' as const,
        createdAt: now,
      })),
    );
    await transaction.insert(ledgerTransactions).values([
      {
        id: '00000000-0000-4000-8000-000000000131',
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        childId: primaryChildId,
        amountCents: 500,
        type: 'MANUAL_CREDIT',
        note: 'Starting balance',
        actorParentId: parentId,
        createdAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000132',
        householdId: DEVELOPMENT_HOUSEHOLD_ID,
        childId: secondaryChildId,
        amountCents: 300,
        type: 'MANUAL_CREDIT',
        note: 'Starting balance',
        actorParentId: parentId,
        createdAt: now,
      },
    ]);
  });
}

function createCredential(
  apiOrigin: string,
  accessToken: string,
): DevelopmentCredential {
  return {
    version: 1,
    apiOrigin,
    accessToken,
  };
}

function requireLocalDevelopmentOrigin(value: string, label: string): string {
  const normalized = normalizeLocalDevelopmentOrigin(value);
  if (!normalized) {
    throw new Error(`${label} must be a local development origin.`);
  }
  return normalized;
}

async function prepareCredentialDirectory(
  directory: string,
  fileOperations: CredentialFileOperations,
): Promise<BoundCredentialDirectory> {
  const { absoluteDirectory, anchor, components } = credentialPath(directory);
  let current = anchor;

  for (const component of components) {
    current = join(current, component);
    const existing = await fileOperations.lstat(current).catch((error) => {
      if (isFileSystemError(error, 'ENOENT')) return undefined;
      throw error;
    });

    if (!existing) {
      await fileOperations.mkdir(current, { mode: 0o700 });
    }
    await assertSafeDirectory(current, fileOperations);
  }

  await assertCredentialPathSafe(directory, fileOperations);
  const physicalPath = await fileOperations.realpath(absoluteDirectory);
  const handle = await fileOperations.openDirectory(
    physicalPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  let operationError: unknown;

  try {
    await handle.chmod(0o700);
    const identity = await handle.stat();
    const boundDirectory = { physicalPath, identity, handle };
    await revalidateCredentialDirectory(boundDirectory, fileOperations);
    return boundDirectory;
  } catch (error) {
    operationError = error;
  }

  try {
    await handle.close();
  } catch (error) {
    throw new AggregateError(
      [operationError, error],
      'Credential directory setup and cleanup failed.',
      { cause: error },
    );
  }
  throw operationError;
}

async function writeCredentialAtomically(
  directory: BoundCredentialDirectory,
  fileName: 'parent.json' | 'dashboard.json',
  credential: DevelopmentCredential,
  fileOperations: CredentialFileOperations,
): Promise<void> {
  const destination = join(directory.physicalPath, fileName);
  await revalidateCredentialDirectory(directory, fileOperations);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  let handle: CredentialFileHandle | undefined;
  let fileIdentity: FileIdentity | undefined;
  let renamed = false;
  let operationError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    handle = await fileOperations.open(
      temporaryPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    fileIdentity = await handle.stat();
    await revalidateCredentialDirectory(directory, fileOperations);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(credential)}\n`, 'utf8');
    await handle.sync();
    await revalidateCredentialDirectory(directory, fileOperations);
    await fileOperations.rename(temporaryPath, destination);
    renamed = true;
    await revalidateCredentialDirectory(directory, fileOperations);
    await handle.close();
    handle = undefined;
  } catch (error) {
    operationError = error;
  }

  if (operationError === undefined) return;

  const cleanupPath = renamed ? destination : temporaryPath;
  let scrubbed = false;
  let handleScrubError: unknown;

  if (handle) {
    try {
      await handle.truncate(0);
      await handle.sync();
      scrubbed = true;
    } catch (error) {
      handleScrubError = error;
    }
  }

  if (!scrubbed && fileIdentity) {
    try {
      scrubbed = await scrubCredentialPathIfSameFile(
        cleanupPath,
        fileIdentity,
        fileOperations,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!scrubbed && handleScrubError !== undefined) {
    cleanupErrors.unshift(handleScrubError);
  }

  if (fileIdentity) {
    try {
      await unlinkCredentialPathIfSameFile(
        cleanupPath,
        fileIdentity,
        fileOperations,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      if (!isFileSystemError(error, 'EBADF')) cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      'Credential write failed and cleanup failed.',
    );
  }
  throw operationError;
}

async function scrubCredentialPathIfSameFile(
  path: string,
  expectedIdentity: FileIdentity,
  fileOperations: CredentialFileOperations,
): Promise<boolean> {
  const handle = await fileOperations
    .open(path, fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600)
    .catch((error) => {
      if (isFileSystemError(error, 'ENOENT')) return undefined;
      throw error;
    });
  if (!handle) return false;

  let operationError: unknown;
  let scrubbed = false;
  try {
    const identity = await handle.stat();
    if (sameFileIdentity(identity, expectedIdentity)) {
      await handle.truncate(0);
      await handle.sync();
      scrubbed = true;
    }
  } catch (error) {
    operationError = error;
  }

  try {
    await handle.close();
  } catch (error) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, error],
        'Credential temporary-file scrubbing and cleanup failed.',
        { cause: error },
      );
    }
    throw error;
  }
  if (operationError !== undefined) throw operationError;
  return scrubbed;
}

async function unlinkCredentialPathIfSameFile(
  path: string,
  expectedIdentity: FileIdentity,
  fileOperations: CredentialFileOperations,
): Promise<void> {
  const status = await fileOperations.lstat(path).catch((error) => {
    if (isFileSystemError(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (
    !status ||
    status.isSymbolicLink() ||
    !sameFileIdentity(status, expectedIdentity)
  ) {
    return;
  }
  await fileOperations.unlink(path);
}

async function revalidateCredentialDirectory(
  directory: BoundCredentialDirectory,
  fileOperations: CredentialFileOperations,
): Promise<void> {
  const [resolvedPath, pathStatus, handleStatus] = await Promise.all([
    fileOperations.realpath(directory.physicalPath),
    fileOperations.lstat(directory.physicalPath),
    directory.handle.stat(),
  ]);
  if (
    resolvedPath !== directory.physicalPath ||
    pathStatus.isSymbolicLink() ||
    !pathStatus.isDirectory() ||
    !sameFileIdentity(pathStatus, directory.identity) ||
    !sameFileIdentity(handleStatus, directory.identity)
  ) {
    throw new Error(
      'Credential output directory changed during credential write.',
    );
  }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function credentialPath(directory: string): {
  absoluteDirectory: string;
  anchor: string;
  components: string[];
} {
  const absoluteDirectory = resolve(directory);
  const candidateAnchors = [resolve(process.cwd()), resolve(tmpdir())]
    .filter((candidate) => isPathWithin(candidate, absoluteDirectory))
    .sort((left, right) => right.length - left.length);
  const anchor = candidateAnchors[0];
  if (!anchor || anchor === absoluteDirectory) {
    throw new Error(
      'Credential output directory must be inside the working or temporary directory.',
    );
  }

  return {
    absoluteDirectory,
    anchor,
    components: relative(anchor, absoluteDirectory).split(sep),
  };
}

function isPathWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..' &&
      !isAbsolute(pathFromParent))
  );
}

async function assertCredentialPathSafe(
  directory: string,
  fileOperations: CredentialFileOperations,
): Promise<void> {
  const { anchor, components } = credentialPath(directory);
  let current = anchor;
  for (const component of components) {
    current = join(current, component);
    await assertSafeDirectory(current, fileOperations);
  }
}

async function assertSafeDirectory(
  directory: string,
  fileOperations: CredentialFileOperations,
): Promise<void> {
  const status = await fileOperations.lstat(directory);
  if (status.isSymbolicLink()) {
    throw new Error('Credential output path cannot contain symbolic links.');
  }
  if (!status.isDirectory()) {
    throw new Error('Credential output path components must be directories.');
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
