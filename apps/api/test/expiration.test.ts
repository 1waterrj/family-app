import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChoreService, type Clock } from '../src/chores/service.js';
import { choreInstances, choreTransitions } from '../src/db/schema.js';
import { expireClaimedChores } from '../src/workers/expire.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(current: Date): void {
    this.current = current;
  }
}

describe('claimed chore expiration worker', () => {
  const claimedAt = new Date('2026-08-08T16:00:00.000Z');
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let clock: MutableClock;
  let service: ChoreService;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    clock = new MutableClock(claimedAt);
    service = new ChoreService(testDatabase.database, clock);
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('returns overdue claimed chores to AVAILABLE and records EXPIRED', async () => {
    const claimed = await createClaimedChore();
    const expiredAt = new Date('2026-08-08T16:30:00.001Z');

    await expect(
      expireClaimedChores(testDatabase!.database, expiredAt, 10),
    ).resolves.toBe(1);

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, claimed.instance.id));
    expect(stored).toMatchObject({
      status: 'AVAILABLE',
      claimedByChildId: null,
      claimDeadlineAt: null,
      submittedAt: null,
    });

    const transitions = await transitionsFor(claimed.instance.id);
    expect(transitions).toHaveLength(2);
    expect(transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromStatus: 'AVAILABLE',
          toStatus: 'CLAIMED',
          actorRole: 'DASHBOARD',
          actorParentId: null,
          actorDashboardDeviceId: claimed.dashboard.actorId,
        }),
        expect.objectContaining({
          fromStatus: 'CLAIMED',
          toStatus: 'AVAILABLE',
          actorRole: 'SYSTEM',
          actorParentId: null,
          actorDashboardDeviceId: null,
          reason: 'EXPIRED',
          createdAt: expiredAt,
        }),
      ]),
    );
  });

  it('does not expire a chore before its future deadline', async () => {
    const claimed = await createClaimedChore(
      new Date('2026-08-08T17:30:00.000Z'),
    );

    await expect(
      expireClaimedChores(
        testDatabase!.database,
        new Date('2026-08-08T16:29:59.999Z'),
        10,
      ),
    ).resolves.toBe(0);

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, claimed.instance.id));
    expect(stored).toMatchObject({
      status: 'CLAIMED',
      claimedByChildId: claimed.child.id,
      claimDeadlineAt: new Date('2026-08-08T18:00:00.000Z'),
    });
    expect(await transitionsFor(claimed.instance.id)).toHaveLength(1);
  });

  it('uses SKIP LOCKED so concurrent workers each honor their batch size', async () => {
    const claimed = [];
    for (let index = 0; index < 12; index += 1) {
      claimed.push(await createClaimedChore());
    }
    const expiredAt = new Date('2026-08-08T16:30:00.001Z');
    const workerBarrierLockKey = 810_007;
    const barrierClient = postgres(testDatabase!.connectionString, { max: 1 });
    const workers: Promise<number>[] = [];
    let advisoryLockHeld = false;
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await barrierClient`SELECT pg_advisory_lock(${workerBarrierLockKey})`;
      advisoryLockHeld = true;
      await testDatabase!.sql.unsafe(`
        CREATE FUNCTION block_expiration_worker_updates()
        RETURNS trigger AS $$
        BEGIN
          IF OLD.status = 'CLAIMED' AND NEW.status = 'AVAILABLE' THEN
            PERFORM pg_advisory_xact_lock(${workerBarrierLockKey});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      functionCreated = true;
      await testDatabase!.sql.unsafe(`
        CREATE TRIGGER block_expiration_worker_updates_trigger
        BEFORE UPDATE ON chore_instances
        FOR EACH ROW
        EXECUTE FUNCTION block_expiration_worker_updates();
      `);
      triggerCreated = true;

      const firstWorker = expireClaimedChores(
        testDatabase!.database,
        expiredAt,
        6,
      );
      workers.push(firstWorker);
      await waitForBlockedWorkerUpdates(1);

      const secondWorker = expireClaimedChores(
        testDatabase!.database,
        expiredAt,
        6,
      );
      workers.push(secondWorker);
      await waitForBlockedWorkerUpdates(2);

      await barrierClient`SELECT pg_advisory_unlock(${workerBarrierLockKey})`;
      await expect(firstWorker).resolves.toBe(6);
      await expect(secondWorker).resolves.toBe(6);
    } finally {
      if (advisoryLockHeld) {
        await barrierClient`SELECT pg_advisory_unlock(${workerBarrierLockKey})`;
      }
      await Promise.allSettled(workers);
      if (triggerCreated) {
        await testDatabase!.sql.unsafe(
          'DROP TRIGGER IF EXISTS block_expiration_worker_updates_trigger ON chore_instances',
        );
      }
      if (functionCreated) {
        await testDatabase!.sql.unsafe(
          'DROP FUNCTION IF EXISTS block_expiration_worker_updates()',
        );
      }
      await barrierClient.end({ timeout: 5 });
    }

    const instances = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.status, 'AVAILABLE'),
          isNull(choreInstances.claimedByChildId),
        ),
      );
    expect(
      instances.filter((instance) =>
        claimed.some(({ instance: expected }) => expected.id === instance.id),
      ),
    ).toHaveLength(12);

    const transitions = await Promise.all(
      claimed.map(({ instance }) => transitionsFor(instance.id)),
    );
    expect(
      transitions.flat().filter((row) => row.reason === 'EXPIRED'),
    ).toHaveLength(12);
    expect(
      new Set(
        transitions
          .flat()
          .filter((row) => row.reason === 'EXPIRED')
          .map((row) => row.choreInstanceId),
      ),
    ).toEqual(new Set(claimed.map(({ instance }) => instance.id)));
  });

  it('is safe to rerun after the batch is complete', async () => {
    const claimed = await createClaimedChore();
    const expiredAt = new Date('2026-08-08T16:30:00.001Z');

    await expect(
      expireClaimedChores(testDatabase!.database, expiredAt, 1),
    ).resolves.toBe(1);
    await expect(
      expireClaimedChores(testDatabase!.database, expiredAt, 1),
    ).resolves.toBe(0);

    const transitions = await transitionsFor(claimed.instance.id);
    expect(transitions.filter((row) => row.reason === 'EXPIRED')).toHaveLength(
      1,
    );
  });

  it('does not modify AWAITING_APPROVAL chores', async () => {
    const claimed = await createClaimedChore();
    clock.set(new Date('2026-08-08T16:10:00.000Z'));
    await service.submit(claimed.dashboard, {
      choreInstanceId: claimed.instance.id,
      childId: claimed.child.id,
      idempotencyKey: randomUUID(),
    });
    const expiredAt = new Date('2026-08-08T16:30:00.001Z');

    await expect(
      expireClaimedChores(testDatabase!.database, expiredAt, 10),
    ).resolves.toBe(0);

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, claimed.instance.id));
    expect(stored).toMatchObject({
      status: 'AWAITING_APPROVAL',
      claimedByChildId: claimed.child.id,
      claimDeadlineAt: new Date('2026-08-08T16:30:00.000Z'),
      submittedAt: new Date('2026-08-08T16:10:00.000Z'),
    });
    expect(await transitionsFor(claimed.instance.id)).toHaveLength(2);
  });

  it('rejects batches outside the supported range', async () => {
    const now = new Date('2026-08-08T16:30:00.001Z');

    await expect(
      expireClaimedChores(testDatabase!.database, now, 0),
    ).rejects.toThrow(/batchSize/i);
    await expect(
      expireClaimedChores(testDatabase!.database, now, 501),
    ).rejects.toThrow(/batchSize/i);
  });

  async function createClaimedChore(claimedOn = claimedAt) {
    clock.set(claimedOn);
    const { child, dashboard, household, parent } = await fixtures.household();
    const template = await service.createTemplate(parent, {
      householdId: household.id,
      name: 'Default chore',
      imageKey: 'tidy-toys',
      instructions: 'Complete the chore.',
      defaultValueCents: 300,
      defaultDurationMinutes: 30,
      idempotencyKey: randomUUID(),
    });
    const instance = await service.publish(parent, {
      householdId: household.id,
      choreTemplateId: template.id,
      idempotencyKey: randomUUID(),
    });
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });

    return { child, dashboard, instance };
  }

  function transitionsFor(choreInstanceId: string) {
    return testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, choreInstanceId))
      .orderBy(asc(choreTransitions.createdAt), asc(choreTransitions.id));
  }

  async function waitForBlockedWorkerUpdates(
    expectedBlockedWorkers: number,
  ): Promise<void> {
    const timeoutAt = Date.now() + 5_000;

    while (Date.now() < timeoutAt) {
      const [state] = await testDatabase!.sql<{ blockedWorkers: number }[]>`
        SELECT count(*)::int AS "blockedWorkers"
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query ILIKE ${'%update "chore_instances"%'}
      `;
      if ((state?.blockedWorkers ?? 0) >= expectedBlockedWorkers) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(
      `Timed out waiting for ${expectedBlockedWorkers} blocked expiration worker updates.`,
    );
  }
});
