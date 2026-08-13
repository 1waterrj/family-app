import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActorContext } from '../src/auth/actor-context.js';
import { ChoreRepository } from '../src/chores/repository.js';
import { ChoreService, type Clock } from '../src/chores/service.js';
import { readConfig } from '../src/config.js';
import {
  approvalDecisions,
  auditEvents,
  choreInstances,
  choreTransitions,
  idempotencyRecords,
  ledgerTransactions,
  parentMemberships,
} from '../src/db/schema.js';
import { IdempotentCommandExecutor } from '../src/idempotency/executor.js';
import { IdempotencyRepository } from '../src/idempotency/repository.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-08-08T18:00:00.000Z');
  }
}

class IdempotencyRaceRepository extends IdempotencyRepository {
  private arrivals = 0;
  private release: (() => void) | undefined;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  initialInsertAttempts = 0;
  observedErrorCodes: string[] = [];

  override async insert(
    ...args: Parameters<IdempotencyRepository['insert']>
  ): Promise<void> {
    this.initialInsertAttempts += 1;
    if (this.initialInsertAttempts <= 2) {
      this.arrivals += 1;
      if (this.arrivals === 2) {
        this.release?.();
      }
      await Promise.race([
        this.gate,
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }

    try {
      return await super.insert(...args);
    } catch (error) {
      const code = findDatabaseErrorCode(error);
      if (code) {
        this.observedErrorCodes.push(code);
      }
      throw error;
    }
  }
}

class PausedIdempotencyRepository extends IdempotencyRepository {
  private signalReached: (() => void) | undefined;
  private releaseInsert: (() => void) | undefined;
  private readonly reached = new Promise<void>((resolve) => {
    this.signalReached = resolve;
  });
  private readonly hold = new Promise<void>((resolve) => {
    this.releaseInsert = resolve;
  });

  observedErrorCodes: string[] = [];
  requestHash: string | undefined;

  waitUntilInsert(): Promise<void> {
    return this.reached;
  }

  allowInsert(): void {
    this.releaseInsert?.();
  }

  override async insert(
    ...args: Parameters<IdempotencyRepository['insert']>
  ): Promise<void> {
    this.requestHash = args[2].requestHash;
    this.signalReached?.();
    await this.hold;
    try {
      return await super.insert(...args);
    } catch (error) {
      const code = findDatabaseErrorCode(error);
      if (code) {
        this.observedErrorCodes.push(code);
      }
      throw error;
    }
  }
}

class PausedBeforeLockRepository extends ChoreRepository {
  private paused = false;
  private signalReached: (() => void) | undefined;
  private releaseLock: (() => void) | undefined;
  private readonly reached = new Promise<void>((resolve) => {
    this.signalReached = resolve;
  });
  private readonly hold = new Promise<void>((resolve) => {
    this.releaseLock = resolve;
  });

  waitUntilPaused(): Promise<void> {
    return this.reached;
  }

  allowLock(): void {
    this.releaseLock?.();
  }

  override async findInstanceForUpdate(
    ...args: Parameters<ChoreRepository['findInstanceForUpdate']>
  ) {
    if (!this.paused) {
      this.paused = true;
      this.signalReached?.();
      await this.hold;
    }
    return super.findInstanceForUpdate(...args);
  }
}

function findDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const databaseError = error as { cause?: unknown; code?: unknown };
  if (typeof databaseError.code === 'string') {
    return databaseError.code;
  }
  return findDatabaseErrorCode(databaseError.cause);
}

function createBarrier(participants: number): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === participants) {
      release?.();
    }
    await gate;
  };
}

describe('atomic parent approval', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let service: ChoreService;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    service = new ChoreService(testDatabase.database, new FixedClock());
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('uses a validated 100_00-cent default payout ceiling', () => {
    expect(readConfig({ DATABASE_URL: 'postgres://localhost/family' })).toEqual(
      {
        apiHost: '127.0.0.1',
        apiPort: 3_000,
        databaseUrl: 'postgres://localhost/family',
        developmentAuthSecret: undefined,
        householdPayoutCeilingCents: 10_000,
        nodeEnv: 'development',
      },
    );
    expect(
      readConfig({
        DATABASE_URL: 'postgres://localhost/family',
        HOUSEHOLD_PAYOUT_CEILING_CENTS: '7500',
      }),
    ).toMatchObject({ householdPayoutCeilingCents: 7_500 });
    expect(() =>
      readConfig({
        DATABASE_URL: 'postgres://localhost/family',
        HOUSEHOLD_PAYOUT_CEILING_CENTS: '-1',
      }),
    ).toThrow();
    expect(() =>
      readConfig({
        DATABASE_URL: 'postgres://localhost/family',
        HOUSEHOLD_PAYOUT_CEILING_CENTS: '20000',
      }),
    ).toThrow();
    expect(
      () =>
        new ChoreService(
          testDatabase!.database,
          new FixedClock(),
          undefined,
          undefined,
          20_000,
        ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('decides each immutable submission attempt independently', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 450);
    await service.reject(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey: randomUUID(),
      retry: true,
      reason: 'Please try once more',
    });
    const [firstDecision] = await decisionsFor(setup.instance.id);

    await service.claim(setup.dashboard, {
      choreInstanceId: setup.instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    });
    const secondSubmission = await service.submit(setup.dashboard, {
      choreInstanceId: setup.instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    });
    const result = await service.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: secondSubmission.submissionAttemptId,
      idempotencyKey: randomUUID(),
      payoutCents: 500,
      note: 'Second submission approved',
    });

    expect(result.status).toBe('APPROVED');
    const attempts = await testDatabase!.sql<
      { attemptNumber: number; id: string }[]
    >`
      SELECT id, attempt_number AS "attemptNumber"
      FROM chore_submission_attempts
      WHERE household_id = ${setup.parent.householdId}
        AND chore_instance_id = ${setup.instance.id}
      ORDER BY attempt_number
    `;
    expect(attempts).toHaveLength(2);
    expect(attempts.map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2]);

    const decisions = await testDatabase!.sql<
      {
        attemptNumber: number;
        decision: 'APPROVED' | 'REJECTED';
        id: string;
        payoutCents: number | null;
      }[]
    >`
      SELECT
        approval_decisions.id,
        approval_decisions.decision,
        approval_decisions.payout_cents AS "payoutCents",
        chore_submission_attempts.attempt_number AS "attemptNumber"
      FROM approval_decisions
      INNER JOIN chore_submission_attempts
        ON chore_submission_attempts.household_id = approval_decisions.household_id
        AND chore_submission_attempts.id = approval_decisions.submission_attempt_id
      WHERE approval_decisions.household_id = ${setup.parent.householdId}
        AND approval_decisions.chore_instance_id = ${setup.instance.id}
      ORDER BY chore_submission_attempts.attempt_number
    `;
    expect(decisions).toEqual([
      {
        id: firstDecision!.id,
        attemptNumber: 1,
        decision: 'REJECTED',
        payoutCents: null,
      },
      {
        id: expect.any(String),
        attemptNumber: 2,
        decision: 'APPROVED',
        payoutCents: 500,
      },
    ]);
    await expect(creditsFor(setup.instance.id)).resolves.toEqual([
      expect.objectContaining({ amountCents: 500 }),
    ]);
  });

  it('targets the requested immutable attempt and credits its claimant snapshot', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 460);
    const firstAttemptId = setup.instance.submissionAttemptId;
    const firstDecisionResult = await service.reject(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: firstAttemptId,
      idempotencyKey: randomUUID(),
      retry: true,
      reason: 'First attempt needs another pass',
    });
    const secondChild = await fixtures.child(setup.household.id, {
      name: 'Second claimant',
      color: 'purple',
    });

    await service.claim(setup.dashboard, {
      choreInstanceId: setup.instance.id,
      childId: secondChild.id,
      idempotencyKey: randomUUID(),
    });
    const secondSubmission = await service.submit(setup.dashboard, {
      choreInstanceId: setup.instance.id,
      childId: secondChild.id,
      idempotencyKey: randomUUID(),
    });

    const staleResult = await service.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: firstAttemptId,
      idempotencyKey: randomUUID(),
      payoutCents: 999,
      note: 'This stale action must not pay the new claimant',
    });

    expect(staleResult).toMatchObject({
      decisionId: firstDecisionResult.decisionId,
      decision: 'REJECTED',
      submissionAttemptId: firstAttemptId,
      payoutCents: null,
    });
    const [stillAwaiting] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, setup.instance.id));
    expect(stillAwaiting).toMatchObject({
      status: 'AWAITING_APPROVAL',
      claimedByChildId: secondChild.id,
    });
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);

    const result = await service.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: secondSubmission.submissionAttemptId,
      idempotencyKey: randomUUID(),
      payoutCents: 500,
    });
    const attempts = await testDatabase!.sql<
      { claimedByChildId: string; id: string }[]
    >`
      SELECT id, claimed_by_child_id AS "claimedByChildId"
      FROM chore_submission_attempts
      WHERE household_id = ${setup.parent.householdId}
        AND chore_instance_id = ${setup.instance.id}
      ORDER BY attempt_number
    `;
    expect(attempts).toEqual([
      { id: firstAttemptId, claimedByChildId: setup.child.id },
      {
        id: secondSubmission.submissionAttemptId,
        claimedByChildId: secondChild.id,
      },
    ]);
    await expect(creditsFor(setup.instance.id)).resolves.toEqual([
      expect.objectContaining({
        childId: secondChild.id,
        approvalDecisionId: result.decisionId,
      }),
    ]);
  });

  it('does not infer a decision target from mutable claim state', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 455);
    await service.reject(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey: randomUUID(),
      retry: true,
    });
    await service.claim(setup.dashboard, {
      choreInstanceId: setup.instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    });

    await expect(
      service.reject(setup.parent, {
        choreInstanceId: setup.instance.id,
        submissionAttemptId: randomUUID(),
        idempotencyKey: randomUUID(),
        retry: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('approves and credits the adjusted payout in one transaction', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 250);
    const idempotencyKey = randomUUID();

    const result = await service.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey,
      payoutCents: 325,
      note: 'Extra care with the glasses',
    });

    expect(result).toMatchObject({
      id: setup.instance.id,
      status: 'APPROVED',
      claimedChildId: setup.child.id,
    });

    const decisions = await testDatabase!.database
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.choreInstanceId, setup.instance.id));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decidedByParentId: setup.parent.actorId,
      decision: 'APPROVED',
      payoutCents: 325,
      note: 'Extra care with the glasses',
      idempotencyKey,
    });

    const credits = await creditsFor(setup.instance.id);
    expect(credits).toEqual([
      expect.objectContaining({
        householdId: setup.parent.householdId,
        childId: setup.child.id,
        amountCents: 325,
        type: 'CHORE_CREDIT',
        note: 'Extra care with the glasses',
        actorParentId: setup.parent.actorId,
        relatedChoreInstanceId: setup.instance.id,
      }),
    ]);

    const [transition] = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(
        and(
          eq(choreTransitions.choreInstanceId, setup.instance.id),
          eq(choreTransitions.toStatus, 'APPROVED'),
        ),
      );
    expect(transition).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      toStatus: 'APPROVED',
      actorRole: 'PARENT',
      actorParentId: setup.parent.actorId,
      reason: 'Extra care with the glasses',
    });

    const [audit] = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, setup.instance.id));
    expect(audit).toMatchObject({
      actorRole: 'PARENT',
      actorParentId: setup.parent.actorId,
      eventType: 'CHORE_APPROVED',
      entityType: 'CHORE_INSTANCE',
      payload: {
        childId: setup.child.id,
        decision: 'APPROVED',
        payoutCents: 325,
      },
    });

    const [idempotency] = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.householdId, setup.parent.householdId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      );
    expect(idempotency).toMatchObject({
      actorRole: 'PARENT',
      actorParentId: setup.parent.actorId,
      operation: 'APPROVE_CHORE',
      response: result,
    });
  });

  it('returns the original result when the same idempotency key is retried', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 400);
    const idempotencyKey = randomUUID();
    const command = {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey,
      payoutCents: 475,
      note: 'Original command',
    };
    const original = await service.approve(setup.parent, command);

    const retried = await service.approve(setup.parent, command);

    expect(retried).toEqual(original);
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(1);
    await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(1);
  });

  it('creates one decision and one credit when two parents approve concurrently', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const setup = await createAwaitingApproval(fixtures, service, 500);
      const secondParent = await addParent(setup.parent.householdId);
      const waitAtBarrier = createBarrier(2);

      const approve = async (
        parent: Extract<ActorContext, { role: 'PARENT' }>,
      ) => {
        await waitAtBarrier();
        return service.approve(parent, {
          choreInstanceId: setup.instance.id,
          submissionAttemptId: setup.instance.submissionAttemptId,
          idempotencyKey: randomUUID(),
          payoutCents: 550,
          note: `Concurrent approval ${attempt}`,
        });
      };

      const results = await Promise.all([
        approve(setup.parent),
        approve(secondParent),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ status: 'APPROVED' });
      await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(1);
      await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(1);
      const approvalTransitions = await testDatabase!.database
        .select()
        .from(choreTransitions)
        .where(
          and(
            eq(choreTransitions.choreInstanceId, setup.instance.id),
            eq(choreTransitions.toStatus, 'APPROVED'),
          ),
        );
      expect(approvalTransitions).toHaveLength(1);
      const audit = await testDatabase!.database
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, setup.instance.id));
      expect(audit).toHaveLength(1);
      const idempotency = await testDatabase!.database
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.householdId, setup.parent.householdId),
            eq(idempotencyRecords.operation, 'APPROVE_CHORE'),
          ),
        );
      expect(idempotency).toHaveLength(2);
    }
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'returns the immutable %s winner from an opposing real-connection race',
    async (winnerDecision) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const setup = await createAwaitingApproval(
          fixtures,
          service,
          505 + attempt,
        );
        const loserRepository = new PausedBeforeLockRepository();
        const loserService = new ChoreService(
          testDatabase!.database,
          new FixedClock(),
          loserRepository,
        );
        const loserKey = randomUUID();
        const winnerKey = randomUUID();
        const target = {
          choreInstanceId: setup.instance.id,
          submissionAttemptId: setup.instance.submissionAttemptId,
        };
        const loser =
          winnerDecision === 'APPROVED'
            ? loserService.reject(setup.parent, {
                ...target,
                idempotencyKey: loserKey,
                retry: false,
              })
            : loserService.approve(setup.parent, {
                ...target,
                idempotencyKey: loserKey,
              });

        await loserRepository.waitUntilPaused();
        let winner;
        try {
          winner =
            winnerDecision === 'APPROVED'
              ? await service.approve(setup.parent, {
                  ...target,
                  idempotencyKey: winnerKey,
                })
              : await service.reject(setup.parent, {
                  ...target,
                  idempotencyKey: winnerKey,
                  retry: false,
                });
        } finally {
          loserRepository.allowLock();
        }
        const loserResult = await loser;

        expect(loserResult).toEqual(winner);
        expect(winner).toMatchObject({
          decision: winnerDecision,
          submissionAttemptId: setup.instance.submissionAttemptId,
        });
        await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(1);
        await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(
          winnerDecision === 'APPROVED' ? 1 : 0,
        );
        const records = await testDatabase!.database
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.householdId, setup.parent.householdId),
              eq(idempotencyRecords.response, winner),
            ),
          );
        expect(records).toHaveLength(2);
      }
    },
  );

  it('rejects the losing payload in concurrent same-key approvals on different chores', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 510);
    const otherInstance = await createAwaitingApprovalForHousehold(
      service,
      setup,
      520,
    );
    const idempotencyKey = randomUUID();
    const repository = new IdempotencyRaceRepository();
    const raceService = new ChoreService(
      testDatabase!.database,
      new FixedClock(),
      undefined,
      undefined,
      undefined,
      new IdempotentCommandExecutor(testDatabase!.database, repository, () =>
        new FixedClock().now(),
      ),
    );
    const waitAtBarrier = createBarrier(2);
    const approve = async (
      instance: Pick<typeof setup.instance, 'id' | 'submissionAttemptId'>,
    ) => {
      await waitAtBarrier();
      return raceService.approve(setup.parent, {
        choreInstanceId: instance.id,
        submissionAttemptId: instance.submissionAttemptId,
        idempotencyKey,
      });
    };

    const results = await Promise.allSettled([
      approve(setup.instance),
      approve(otherInstance),
    ]);

    expect(repository.initialInsertAttempts).toBe(2);
    expect(repository.observedErrorCodes).toContain('40001');
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const [rejected] = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
    const decisions = await testDatabase!.database
      .select()
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.householdId, setup.parent.householdId),
          eq(approvalDecisions.idempotencyKey, idempotencyKey),
        ),
      );
    expect(decisions).toHaveLength(1);
    const credits = await testDatabase!.database
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.householdId, setup.parent.householdId),
          eq(ledgerTransactions.type, 'CHORE_CREDIT'),
        ),
      );
    expect(credits).toHaveLength(1);
    const instances = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.householdId, setup.parent.householdId));
    expect(instances.map(({ status }) => status).sort()).toEqual([
      'APPROVED',
      'AWAITING_APPROVAL',
    ]);
    const idempotency = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, idempotencyKey));
    expect(idempotency).toHaveLength(1);
  });

  it('rolls back the losing operation on concurrent cross-operation key reuse', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 530);
    const otherInstance = await createAwaitingApprovalForHousehold(
      service,
      setup,
      540,
    );
    const idempotencyKey = randomUUID();
    const repository = new IdempotencyRaceRepository();
    const raceService = new ChoreService(
      testDatabase!.database,
      new FixedClock(),
      undefined,
      undefined,
      undefined,
      new IdempotentCommandExecutor(testDatabase!.database, repository, () =>
        new FixedClock().now(),
      ),
    );
    const waitAtBarrier = createBarrier(2);
    const approve = async () => {
      await waitAtBarrier();
      return raceService.approve(setup.parent, {
        choreInstanceId: setup.instance.id,
        submissionAttemptId: setup.instance.submissionAttemptId,
        idempotencyKey,
      });
    };
    const reject = async () => {
      await waitAtBarrier();
      return raceService.reject(setup.parent, {
        choreInstanceId: otherInstance.id,
        submissionAttemptId: otherInstance.submissionAttemptId,
        idempotencyKey,
        retry: false,
      });
    };

    const results = await Promise.allSettled([approve(), reject()]);

    expect(repository.initialInsertAttempts).toBe(2);
    expect(repository.observedErrorCodes).toContain('40001');
    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof raceService.approve>>
      > => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'CONFLICT' });

    const decisions = await testDatabase!.database
      .select()
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.householdId, setup.parent.householdId),
          eq(approvalDecisions.idempotencyKey, idempotencyKey),
        ),
      );
    expect(decisions).toHaveLength(1);
    const credits = await testDatabase!.database
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.householdId, setup.parent.householdId),
          eq(ledgerTransactions.type, 'CHORE_CREDIT'),
        ),
      );
    expect(credits).toHaveLength(
      fulfilled[0]?.value.status === 'APPROVED' ? 1 : 0,
    );
    const audit = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.householdId, setup.parent.householdId));
    expect(audit).toHaveLength(1);
    const idempotency = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, idempotencyKey));
    expect(idempotency).toHaveLength(1);
  });

  it('retries a real 23505 idempotency conflict and rolls back partial approval writes', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 545);
    const idempotencyKey = randomUUID();
    const externalDecisionId = randomUUID();
    const repository = new PausedIdempotencyRepository();
    const raceService = new ChoreService(
      testDatabase!.database,
      new FixedClock(),
      undefined,
      undefined,
      undefined,
      new IdempotentCommandExecutor(testDatabase!.database, repository, () =>
        new FixedClock().now(),
      ),
    );
    const operation = raceService.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey,
    });

    await repository.waitUntilInsert();
    try {
      await testDatabase!.database.insert(idempotencyRecords).values({
        householdId: setup.parent.householdId,
        idempotencyKey,
        actorRole: 'PARENT',
        actorParentId: setup.parent.actorId,
        actorDashboardDeviceId: null,
        operation: 'APPROVE_CHORE',
        requestHash: repository.requestHash!,
        response: {
          ...setup.instance,
          decisionId: externalDecisionId,
          submissionAttemptId: setup.instance.submissionAttemptId,
          decision: 'APPROVED',
          payoutCents: setup.instance.valueCents,
          note: null,
        },
        createdAt: new FixedClock().now(),
      });
    } finally {
      repository.allowInsert();
    }

    await expect(operation).resolves.toEqual({
      ...setup.instance,
      decisionId: externalDecisionId,
      submissionAttemptId: setup.instance.submissionAttemptId,
      decision: 'APPROVED',
      payoutCents: setup.instance.valueCents,
      note: null,
    });
    expect(repository.observedErrorCodes).toContain('23505');
    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, setup.instance.id));
    expect(stored?.status).toBe('AWAITING_APPROVAL');
    await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(0);
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);
    const approvalTransitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(
        and(
          eq(choreTransitions.choreInstanceId, setup.instance.id),
          eq(choreTransitions.toStatus, 'APPROVED'),
        ),
      );
    expect(approvalTransitions).toHaveLength(0);
    const audit = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, setup.instance.id));
    expect(audit).toHaveLength(0);
    const idempotency = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, idempotencyKey));
    expect(idempotency).toHaveLength(1);
  });

  it('rolls back chore approval when ledger insertion fails', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 600);
    const idempotencyKey = randomUUID();

    await testDatabase!.sql.unsafe(`
      CREATE FUNCTION test_fail_chore_credit() RETURNS trigger AS $$
      BEGIN
        IF NEW.note = 'FORCE_LEDGER_FAILURE' THEN
          RAISE EXCEPTION 'forced ledger insertion failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_chore_credit
      BEFORE INSERT ON ledger_transactions
      FOR EACH ROW EXECUTE FUNCTION test_fail_chore_credit();
    `);

    try {
      await expect(
        service.approve(setup.parent, {
          choreInstanceId: setup.instance.id,
          submissionAttemptId: setup.instance.submissionAttemptId,
          idempotencyKey,
          payoutCents: 625,
          note: 'FORCE_LEDGER_FAILURE',
        }),
      ).rejects.toMatchObject({ cause: { code: 'P0001' } });
    } finally {
      await testDatabase!.sql.unsafe(`
        DROP TRIGGER IF EXISTS test_fail_chore_credit ON ledger_transactions;
        DROP FUNCTION IF EXISTS test_fail_chore_credit();
      `);
    }

    const [instance] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, setup.instance.id));
    expect(instance?.status).toBe('AWAITING_APPROVAL');
    await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(0);
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);
    const approvalTransitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(
        and(
          eq(choreTransitions.choreInstanceId, setup.instance.id),
          eq(choreTransitions.toStatus, 'APPROVED'),
        ),
      );
    expect(approvalTransitions).toHaveLength(0);
    const audit = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, setup.instance.id));
    expect(audit).toHaveLength(0);
    const idempotency = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, idempotencyKey));
    expect(idempotency).toHaveLength(0);
  });

  it('reject-and-retry returns the instance to AVAILABLE without a credit', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 700);
    const idempotencyKey = randomUUID();

    const command = {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey,
      retry: true,
      reason: 'Please clean the corners too',
    };
    const result = await service.reject(setup.parent, command);
    const retried = await service.reject(setup.parent, command);

    expect(retried).toEqual(result);
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      claimedChildId: null,
      claimDeadlineAt: null,
      submittedAt: null,
    });
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);
    const [decision] = await decisionsFor(setup.instance.id);
    expect(decision).toMatchObject({
      decidedByParentId: setup.parent.actorId,
      decision: 'REJECTED',
      payoutCents: null,
      note: 'Please clean the corners too',
    });
    const [transition] = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(
        and(
          eq(choreTransitions.choreInstanceId, setup.instance.id),
          eq(choreTransitions.toStatus, 'AVAILABLE'),
        ),
      );
    expect(transition).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      actorParentId: setup.parent.actorId,
      reason: 'Please clean the corners too',
    });
    const rejectionAudit = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, setup.instance.id));
    expect(rejectionAudit).toHaveLength(1);
    const rejectionIdempotency = await testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.householdId, setup.parent.householdId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      );
    expect(rejectionIdempotency).toHaveLength(1);
  });

  it('reject-and-close closes the instance without a credit', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 800);

    const result = await service.reject(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey: randomUUID(),
      retry: false,
      reason: 'This chore is no longer needed',
    });

    expect(result).toMatchObject({ status: 'CLOSED' });
    await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);
    const [audit] = await testDatabase!.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, setup.instance.id));
    expect(audit).toMatchObject({
      actorParentId: setup.parent.actorId,
      eventType: 'CHORE_REJECTED',
      payload: {
        decision: 'REJECTED',
        reason: 'This chore is no longer needed',
        retry: false,
      },
    });
  });

  it('returns the immutable rejection decision ID from the atomic operation', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 705);

    const result = await service.reject(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey: randomUUID(),
      retry: true,
      reason: 'Try this chore again',
    });

    const [decision] = await decisionsFor(setup.instance.id);
    expect(result).toMatchObject({ decisionId: decision!.id });
  });

  it.each([-1, 10_001])(
    'rejects payout value %s outside the configured household ceiling',
    async (payoutCents) => {
      const setup = await createAwaitingApproval(fixtures, service, 900);

      await expect(
        service.approve(setup.parent, {
          choreInstanceId: setup.instance.id,
          submissionAttemptId: setup.instance.submissionAttemptId,
          idempotencyKey: randomUUID(),
          payoutCents,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(0);
      await expect(creditsFor(setup.instance.id)).resolves.toHaveLength(0);
    },
  );

  it('accepts a zero-cent approval at the lower payout boundary', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 100);

    const result = await service.approve(setup.parent, {
      choreInstanceId: setup.instance.id,
      submissionAttemptId: setup.instance.submissionAttemptId,
      idempotencyKey: randomUUID(),
      payoutCents: 0,
    });

    expect(result.status).toBe('APPROVED');
    await expect(creditsFor(setup.instance.id)).resolves.toEqual([
      expect.objectContaining({ amountCents: 0, type: 'CHORE_CREDIT' }),
    ]);
  });

  it('rejects dashboards and hides chores in another household', async () => {
    const setup = await createAwaitingApproval(fixtures, service, 300);
    const other = await fixtures.household();

    await expect(
      service.approve(setup.dashboard, {
        choreInstanceId: setup.instance.id,
        submissionAttemptId: setup.instance.submissionAttemptId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.approve(other.parent, {
        choreInstanceId: setup.instance.id,
        submissionAttemptId: setup.instance.submissionAttemptId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(decisionsFor(setup.instance.id)).resolves.toHaveLength(0);
  });

  it('rejects cross-operation reuse of an idempotency key', async () => {
    const approvedSetup = await createAwaitingApproval(fixtures, service, 300);
    const rejectedSetup = await createAwaitingApprovalForHousehold(
      service,
      approvedSetup,
      350,
    );
    const idempotencyKey = randomUUID();

    await service.approve(approvedSetup.parent, {
      choreInstanceId: approvedSetup.instance.id,
      submissionAttemptId: approvedSetup.instance.submissionAttemptId,
      idempotencyKey,
    });

    await expect(
      service.reject(approvedSetup.parent, {
        choreInstanceId: rejectedSetup.id,
        submissionAttemptId: rejectedSetup.submissionAttemptId,
        idempotencyKey,
        retry: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(decisionsFor(rejectedSetup.id)).resolves.toHaveLength(0);
  });

  async function addParent(
    householdId: string,
  ): Promise<Extract<ActorContext, { role: 'PARENT' }>> {
    const parentId = randomUUID();
    await testDatabase!.database
      .insert(parentMemberships)
      .values({ householdId, parentId });
    return { role: 'PARENT', actorId: parentId, householdId };
  }

  async function decisionsFor(choreInstanceId: string) {
    return testDatabase!.database
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.choreInstanceId, choreInstanceId));
  }

  async function creditsFor(choreInstanceId: string) {
    return testDatabase!.database
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.relatedChoreInstanceId, choreInstanceId),
          eq(ledgerTransactions.type, 'CHORE_CREDIT'),
        ),
      );
  }
});

async function createAwaitingApproval(
  fixtures: Fixtures,
  service: ChoreService,
  valueCents: number,
) {
  const household = await fixtures.household();
  const instance = await createAwaitingApprovalForHousehold(
    service,
    household,
    valueCents,
  );
  return { ...household, instance };
}

async function createAwaitingApprovalForHousehold(
  service: ChoreService,
  household: Awaited<ReturnType<Fixtures['household']>>,
  valueCents: number,
) {
  const template = await service.createTemplate(household.parent, {
    householdId: household.household.id,
    name: 'Polish the silverware',
    imageKey: 'tidy-toys',
    instructions: 'Polish every piece and put it away.',
    defaultValueCents: valueCents,
    defaultDurationMinutes: 30,
    idempotencyKey: randomUUID(),
  });
  const instance = await service.publish(household.parent, {
    householdId: household.household.id,
    choreTemplateId: template.id,
    idempotencyKey: randomUUID(),
  });
  await service.claim(household.dashboard, {
    choreInstanceId: instance.id,
    childId: household.child.id,
    idempotencyKey: randomUUID(),
  });
  return service.submit(household.dashboard, {
    choreInstanceId: instance.id,
    childId: household.child.id,
    idempotencyKey: randomUUID(),
  });
}
