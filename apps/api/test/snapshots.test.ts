import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  DashboardSnapshotSchema,
  ParentSnapshotSchema,
} from '@family/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  issueDevelopmentActorToken,
  type ActorContext,
} from '../src/auth/actor-context.js';
import type { Clock } from '../src/chores/service.js';
import {
  approvalDecisions,
  choreInstances,
  choreSubmissionAttempts,
  choreTemplates,
  choreTransitions,
  ledgerTransactions,
} from '../src/db/schema.js';
import { SnapshotRepository } from '../src/snapshots/repository.js';
import { SnapshotService } from '../src/snapshots/service.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

const developmentAuthSecret =
  'test-only-development-auth-secret-with-at-least-32-characters';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-08-09T12:30:00.000Z');
  }
}

class PausedAfterBalancesRepository extends SnapshotRepository {
  private signalBalancesRead: (() => void) | undefined;
  private releaseSnapshot: (() => void) | undefined;
  private readonly balancesRead = new Promise<void>((resolve) => {
    this.signalBalancesRead = resolve;
  });
  private readonly hold = new Promise<void>((resolve) => {
    this.releaseSnapshot = resolve;
  });

  waitUntilBalancesRead(): Promise<void> {
    return this.balancesRead;
  }

  allowSnapshot(): void {
    this.releaseSnapshot?.();
  }

  override async listChildrenWithBalances(
    ...args: Parameters<SnapshotRepository['listChildrenWithBalances']>
  ) {
    const children = await super.listChildrenWithBalances(...args);
    this.signalBalancesRead?.();
    await this.hold;
    return children;
  }
}

describe('role-safe family snapshots', () => {
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
      clock: new FixedClock(),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase?.stop();
  });

  it('returns parent approval references while keeping the dashboard projection child-safe', async () => {
    const { child, dashboard, household, parent } = await fixtures.household();
    const zeroBalanceChild = await fixtures.child(household.id, {
      name: 'Riley',
      color: 'green',
    });
    const { attempt, chore, template } = await seedPendingApproval(
      testDatabase!,
      household.id,
      child.id,
      parent.actorId,
      dashboard.actorId,
    );
    await testDatabase!.database.insert(ledgerTransactions).values({
      householdId: household.id,
      childId: child.id,
      amountCents: 425,
      type: 'MANUAL_CREDIT',
      note: 'private note',
      actorParentId: parent.actorId,
    });

    const parentResponse = await app.inject({
      method: 'GET',
      url: '/v1/parent/snapshot',
      headers: actorHeaders(parent),
    });
    expect(parentResponse.statusCode).toBe(200);
    const parentSnapshot = ParentSnapshotSchema.parse(parentResponse.json());
    expect(parentSnapshot.pendingApprovals[0]?.submissionAttemptId).toBe(
      attempt.id,
    );
    expect(parentSnapshot.pendingApprovals[0]).toMatchObject({
      child: { id: child.id },
      chore: { id: chore.id },
      claimedAt: '2026-08-09T11:00:00.000Z',
      submittedAt: '2026-08-09T12:00:00.000Z',
    });
    expect(parentSnapshot.children).toEqual([
      expect.objectContaining({
        profile: expect.objectContaining({ id: child.id }),
        balanceCents: 425,
      }),
      expect.objectContaining({
        profile: expect.objectContaining({ id: zeroBalanceChild.id }),
        balanceCents: 0,
      }),
    ]);
    expect(parentSnapshot.templates).toEqual([
      expect.objectContaining({ id: template.id }),
    ]);
    expect(parentSnapshot.serverTime).toBe('2026-08-09T12:30:00.000Z');

    const dashboardResponse = await app.inject({
      method: 'GET',
      url: '/v1/dashboard/snapshot',
      headers: actorHeaders(dashboard),
    });
    expect(dashboardResponse.statusCode).toBe(200);
    const dashboardSnapshot = DashboardSnapshotSchema.parse(
      dashboardResponse.json(),
    );
    expect(JSON.stringify(dashboardSnapshot)).not.toMatch(
      /private note|actorParentId|approvalDecisionId|submissionAttemptId/,
    );
    expect(Object.keys(dashboardSnapshot).sort()).toEqual([
      'children',
      'chores',
      'household',
      'serverTime',
    ]);
    expect(Object.keys(dashboardSnapshot.chores[0]!).sort()).toEqual([
      'choreTemplateId',
      'claimDeadlineAt',
      'claimedChildId',
      'createdAt',
      'durationMinutes',
      'id',
      'imageKey',
      'imageUrl',
      'instructions',
      'name',
      'status',
      'submittedAt',
      'valueCents',
    ]);
  });

  it('enforces endpoint roles and verifies registered actors', async () => {
    const { dashboard, household, parent } = await fixtures.household();

    const parentToDashboard = await app.inject({
      method: 'GET',
      url: '/v1/dashboard/snapshot',
      headers: actorHeaders(parent),
    });
    expect(parentToDashboard.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(parentToDashboard.json())).toMatchObject({
      code: 'FORBIDDEN',
    });

    const dashboardToParent = await app.inject({
      method: 'GET',
      url: '/v1/parent/snapshot',
      headers: actorHeaders(dashboard),
    });
    expect(dashboardToParent.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(dashboardToParent.json())).toMatchObject({
      code: 'FORBIDDEN',
    });

    const unregisteredParent: ActorContext = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: household.id,
    };
    const missingMembership = await app.inject({
      method: 'GET',
      url: '/v1/parent/snapshot',
      headers: actorHeaders(unregisteredParent),
    });
    expect(missingMembership.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(missingMembership.json())).toMatchObject({
      code: 'NOT_FOUND',
    });

    const unregisteredDashboard: ActorContext = {
      role: 'DASHBOARD',
      actorId: randomUUID(),
      householdId: household.id,
    };
    const missingDevice = await app.inject({
      method: 'GET',
      url: '/v1/dashboard/snapshot',
      headers: actorHeaders(unregisteredDashboard),
    });
    expect(missingDevice.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(missingDevice.json())).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('orders pending approvals oldest-first with an id tiebreaker and preserves legacy null claims', async () => {
    const { child, dashboard, household, parent } = await fixtures.household();
    const [template] = await testDatabase!.database
      .insert(choreTemplates)
      .values({
        householdId: household.id,
        createdByParentId: parent.actorId,
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        instructions: 'Put toys away.',
        defaultValueCents: 250,
        defaultDurationSeconds: 900,
      })
      .returning();
    const choreIds = {
      early: '00000000-0000-4000-8000-0000000000ff',
      tieLow: '00000000-0000-4000-8000-000000000001',
      tieHigh: '00000000-0000-4000-8000-000000000002',
    };
    await testDatabase!.database.insert(choreInstances).values(
      Object.values(choreIds).map((id) => ({
        id,
        householdId: household.id,
        choreTemplateId: template!.id,
        name: 'Tidy toys',
        imageKey: 'tidy-toys' as const,
        instructions: 'Put toys away.',
        valueCents: 250,
        durationSeconds: 900,
        status: 'AWAITING_APPROVAL' as const,
        claimedByChildId: child.id,
        claimDeadlineAt: new Date('2026-08-09T11:15:00.000Z'),
        submittedAt: new Date('2026-08-09T11:00:00.000Z'),
      })),
    );
    const attemptIds = {
      early: '00000000-0000-4000-8000-0000000000ff',
      tieLow: '00000000-0000-4000-8000-000000000001',
      tieHigh: '00000000-0000-4000-8000-000000000002',
    };
    await testDatabase!.database.insert(choreSubmissionAttempts).values([
      {
        id: attemptIds.early,
        householdId: household.id,
        choreInstanceId: choreIds.early,
        claimedByChildId: child.id,
        attemptNumber: 1,
        submittedAt: new Date('2026-08-09T10:00:00.000Z'),
      },
      {
        id: attemptIds.tieHigh,
        householdId: household.id,
        choreInstanceId: choreIds.tieHigh,
        claimedByChildId: child.id,
        attemptNumber: 1,
        submittedAt: new Date('2026-08-09T11:00:00.000Z'),
      },
      {
        id: attemptIds.tieLow,
        householdId: household.id,
        choreInstanceId: choreIds.tieLow,
        claimedByChildId: child.id,
        attemptNumber: 1,
        submittedAt: new Date('2026-08-09T11:00:00.000Z'),
      },
    ]);
    await testDatabase!.database.insert(choreTransitions).values({
      householdId: household.id,
      choreInstanceId: choreIds.tieLow,
      fromStatus: 'AVAILABLE',
      toStatus: 'CLAIMED',
      actorRole: 'DASHBOARD',
      actorDashboardDeviceId: dashboard.actorId,
      createdAt: new Date('2026-08-09T10:30:00.000Z'),
    });

    const service = new SnapshotService(
      testDatabase!.database,
      new FixedClock(),
    );
    const snapshot = await service.getParentSnapshot(parent);

    expect(
      snapshot.pendingApprovals.map(({ claimedAt, submissionAttemptId }) => ({
        claimedAt,
        submissionAttemptId,
      })),
    ).toEqual([
      { claimedAt: null, submissionAttemptId: attemptIds.early },
      {
        claimedAt: '2026-08-09T10:30:00.000Z',
        submissionAttemptId: attemptIds.tieLow,
      },
      { claimedAt: null, submissionAttemptId: attemptIds.tieHigh },
    ]);
  });

  it('reads every dashboard section from one repeatable-read snapshot', async () => {
    const { child, dashboard, household, parent } = await fixtures.household();
    const [template] = await testDatabase!.database
      .insert(choreTemplates)
      .values({
        householdId: household.id,
        createdByParentId: parent.actorId,
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        instructions: 'Put toys away.',
        defaultValueCents: 250,
        defaultDurationSeconds: 900,
      })
      .returning();
    const repository = new PausedAfterBalancesRepository();
    const service = new SnapshotService(
      testDatabase!.database,
      new FixedClock(),
      repository,
    );
    const snapshotPromise = service.getDashboardSnapshot(dashboard);

    await repository.waitUntilBalancesRead();
    try {
      await testDatabase!.database.insert(choreInstances).values({
        householdId: household.id,
        choreTemplateId: template!.id,
        name: 'Concurrent chore',
        imageKey: 'tidy-toys',
        instructions: 'This belongs to the next snapshot.',
        valueCents: 100,
        durationSeconds: 300,
        status: 'AVAILABLE',
      });
    } finally {
      repository.allowSnapshot();
    }

    await expect(snapshotPromise).resolves.toMatchObject({
      children: [
        expect.objectContaining({
          profile: expect.objectContaining({ id: child.id }),
        }),
      ],
      chores: [],
    });
    await expect(
      service.getDashboardSnapshot(dashboard),
    ).resolves.toMatchObject({
      chores: [expect.objectContaining({ name: 'Concurrent chore' })],
    });
  });
});

async function seedPendingApproval(
  testDatabase: TestDatabase,
  householdId: string,
  childId: string,
  parentId: string,
  dashboardId: string,
) {
  const [template] = await testDatabase.database
    .insert(choreTemplates)
    .values({
      householdId,
      createdByParentId: parentId,
      name: 'Tidy toys',
      imageKey: 'tidy-toys',
      instructions: 'Put the toys in their bins.',
      defaultValueCents: 250,
      defaultDurationSeconds: 900,
    })
    .returning();
  const [chore] = await testDatabase.database
    .insert(choreInstances)
    .values({
      householdId,
      choreTemplateId: template!.id,
      name: template!.name,
      imageKey: template!.imageKey,
      instructions: template!.instructions,
      valueCents: template!.defaultValueCents,
      durationSeconds: template!.defaultDurationSeconds,
      status: 'AWAITING_APPROVAL',
      claimedByChildId: childId,
      claimDeadlineAt: new Date('2026-08-09T12:15:00.000Z'),
      submittedAt: new Date('2026-08-09T12:00:00.000Z'),
      createdAt: new Date('2026-08-09T09:00:00.000Z'),
    })
    .returning();
  const [oldAttempt, attempt] = await testDatabase.database
    .insert(choreSubmissionAttempts)
    .values([
      {
        householdId,
        choreInstanceId: chore!.id,
        claimedByChildId: childId,
        attemptNumber: 1,
        submittedAt: new Date('2026-08-09T10:00:00.000Z'),
        createdAt: new Date('2026-08-09T10:00:00.000Z'),
      },
      {
        householdId,
        choreInstanceId: chore!.id,
        claimedByChildId: childId,
        attemptNumber: 2,
        submittedAt: new Date('2026-08-09T12:00:00.000Z'),
        createdAt: new Date('2026-08-09T12:00:00.000Z'),
      },
    ])
    .returning();
  await testDatabase.database.insert(choreTransitions).values([
    {
      householdId,
      choreInstanceId: chore!.id,
      fromStatus: 'AVAILABLE',
      toStatus: 'CLAIMED',
      actorRole: 'DASHBOARD',
      actorDashboardDeviceId: dashboardId,
      createdAt: new Date('2026-08-09T09:30:00.000Z'),
    },
    {
      householdId,
      choreInstanceId: chore!.id,
      fromStatus: 'AVAILABLE',
      toStatus: 'CLAIMED',
      actorRole: 'DASHBOARD',
      actorDashboardDeviceId: dashboardId,
      createdAt: new Date('2026-08-09T11:00:00.000Z'),
    },
  ]);
  await testDatabase.database.insert(approvalDecisions).values({
    householdId,
    choreInstanceId: chore!.id,
    submissionAttemptId: oldAttempt!.id,
    decidedByParentId: parentId,
    decision: 'REJECTED',
    payoutCents: null,
    note: 'private decision note',
    idempotencyKey: randomUUID(),
    createdAt: new Date('2026-08-09T10:30:00.000Z'),
  });

  const [savedChore] = await testDatabase.database
    .select()
    .from(choreInstances)
    .where(
      and(
        eq(choreInstances.householdId, householdId),
        eq(choreInstances.id, chore!.id),
      ),
    );
  return { attempt: attempt!, chore: savedChore!, template: template! };
}

function actorHeaders(actor: ActorContext) {
  return {
    authorization: `Bearer ${issueDevelopmentActorToken(actor, developmentAuthSecret)}`,
  };
}
