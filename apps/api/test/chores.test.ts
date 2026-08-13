import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActorContext } from '../src/auth/actor-context.js';
import {
  choreInstances,
  choreTemplates,
  choreTransitions,
} from '../src/db/schema.js';
import { HouseholdService } from '../src/households/service.js';
import { ChoreService, type Clock } from '../src/chores/service.js';
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

type CapturedResult<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

async function runWhileInstanceRowIsLocked<T>(
  testDatabase: TestDatabase,
  choreInstanceId: string,
  operation: () => Promise<T>,
  whileBlocked: () => void,
): Promise<CapturedResult<T>> {
  let signalLockAcquired: (() => void) | undefined;
  let releaseLock: (() => void) | undefined;
  const lockAcquired = new Promise<void>((resolve) => {
    signalLockAcquired = resolve;
  });
  const holdLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const lockTransaction = testDatabase.database.transaction(
    async (transaction) => {
      await transaction
        .select({ id: choreInstances.id })
        .from(choreInstances)
        .where(eq(choreInstances.id, choreInstanceId))
        .for('update');
      signalLockAcquired?.();
      await holdLock;
    },
  );

  await lockAcquired;
  const operationResult = operation().then<CapturedResult<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );

  try {
    await waitForPostgresLockWait(testDatabase);
    whileBlocked();
  } finally {
    releaseLock?.();
    await lockTransaction;
  }

  return operationResult;
}

async function waitForPostgresLockWait(
  testDatabase: TestDatabase,
): Promise<void> {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const [state] = await testDatabase.sql<{ isWaiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
      ) AS "isWaiting"
    `;
    if (state?.isWaiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for the service transaction row lock.');
}

describe('chore lifecycle', () => {
  const initialNow = new Date('2026-08-08T16:00:00.000Z');
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let clock: MutableClock;
  let service: ChoreService;
  let householdService: HouseholdService;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 4 });
    fixtures = createFixtures(testDatabase.database);
    clock = new MutableClock(initialNow);
    service = new ChoreService(testDatabase.database, clock);
    householdService = new HouseholdService(testDatabase.database);
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('publishes an instance with copied defaults and optional overrides', async () => {
    const { parent, household } = await fixtures.household();
    const template = await service.createTemplate(parent, {
      householdId: household.id,
      name: 'Unload the dishwasher',
      imageKey: 'tidy-toys',
      imageUrl: 'https://example.test/dishwasher.png',
      instructions: 'Put each item in its usual cabinet.',
      defaultValueCents: 250,
      defaultDurationMinutes: 30,
      idempotencyKey: randomUUID(),
    });

    expect(template.imageKey).toBe('tidy-toys');

    const copied = await service.publish(parent, {
      householdId: household.id,
      choreTemplateId: template.id,
      idempotencyKey: randomUUID(),
    });
    const overridden = await service.publish(parent, {
      householdId: household.id,
      choreTemplateId: template.id,
      valueCents: 400,
      instructions: 'Also wipe down the counter.',
      durationMinutes: 45,
      idempotencyKey: randomUUID(),
    });

    expect(copied).toMatchObject({
      householdId: household.id,
      choreTemplateId: template.id,
      name: 'Unload the dishwasher',
      imageKey: 'tidy-toys',
      imageUrl: 'https://example.test/dishwasher.png',
      instructions: 'Put each item in its usual cabinet.',
      valueCents: 250,
      durationMinutes: 30,
      status: 'AVAILABLE',
      claimedChildId: null,
      claimDeadlineAt: null,
      submittedAt: null,
    });
    expect(overridden).toMatchObject({
      name: 'Unload the dishwasher',
      imageUrl: 'https://example.test/dishwasher.png',
      instructions: 'Also wipe down the counter.',
      valueCents: 400,
      durationMinutes: 45,
    });

    await testDatabase!.database
      .update(choreTemplates)
      .set({
        name: 'Changed later',
        instructions: 'Changed later',
        defaultValueCents: 999,
        defaultDurationSeconds: 60,
      })
      .where(eq(choreTemplates.id, template.id));

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, copied.id));
    expect(stored).toMatchObject({
      name: 'Unload the dishwasher',
      imageKey: 'tidy-toys',
      instructions: 'Put each item in its usual cabinet.',
      valueCents: 250,
      durationSeconds: 1_800,
    });
  });

  it('allows exactly one winner when two children claim concurrently', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      clock.set(initialNow);
      const {
        child: firstChild,
        parent,
        dashboard,
        household,
      } = await fixtures.household();
      const secondChild = await householdService.createChild(parent, {
        name: `Second child ${attempt}`,
        color: 'purple',
        idempotencyKey: randomUUID(),
      });
      const template = await createTemplate(service, parent, household.id);
      const instance = await service.publish(parent, {
        householdId: household.id,
        choreTemplateId: template.id,
        idempotencyKey: randomUUID(),
      });
      const waitAtBarrier = createBarrier(2);

      const claim = async (childId: string) => {
        await waitAtBarrier();
        return service.claim(dashboard, {
          choreInstanceId: instance.id,
          childId,
          idempotencyKey: randomUUID(),
        });
      };
      const results = await Promise.allSettled([
        claim(firstChild.id),
        claim(secondChild.id),
      ]);

      const fulfilled = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.claim>>
        > => result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'CHORE_UNAVAILABLE' });

      const transitions = await testDatabase!.database
        .select()
        .from(choreTransitions)
        .where(eq(choreTransitions.choreInstanceId, instance.id));
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({
        fromStatus: 'AVAILABLE',
        toStatus: 'CLAIMED',
        actorRole: 'DASHBOARD',
        actorParentId: null,
        actorDashboardDeviceId: dashboard.actorId,
      });
    }
  });

  it('samples the claim deadline after acquiring the chore row lock', async () => {
    clock.set(initialNow);
    const { child, dashboard, household, parent } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);

    const result = await runWhileInstanceRowIsLocked(
      testDatabase!,
      instance.id,
      () =>
        service.claim(dashboard, {
          choreInstanceId: instance.id,
          childId: child.id,
          idempotencyKey: randomUUID(),
        }),
      () => clock.set(new Date('2026-08-08T16:05:00.000Z')),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: expect.objectContaining({
        status: 'CLAIMED',
        claimDeadlineAt: '2026-08-08T16:35:00.000Z',
      }),
    });
  });

  it('rejects submission by a child other than the claimant', async () => {
    clock.set(initialNow);
    const {
      child: claimant,
      parent,
      dashboard,
      household,
    } = await fixtures.household();
    const otherChild = await householdService.createChild(parent, {
      name: 'Other child',
      color: 'green',
      idempotencyKey: randomUUID(),
    });
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: claimant.id,
      idempotencyKey: randomUUID(),
    });

    await expect(
      service.submit(dashboard, {
        choreInstanceId: instance.id,
        childId: otherChild.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(stored?.status).toBe('CLAIMED');
  });

  it('rejects submission after the server deadline', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    clock.set(new Date('2026-08-08T16:30:00.001Z'));

    await expect(
      service.submit(dashboard, {
        choreInstanceId: instance.id,
        childId: child.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(stored).toMatchObject({ status: 'CLAIMED', submittedAt: null });
  });

  it('rejects submission when its row-lock wait reaches the exact deadline', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    clock.set(new Date('2026-08-08T16:29:59.999Z'));

    const result = await runWhileInstanceRowIsLocked(
      testDatabase!,
      instance.id,
      () =>
        service.submit(dashboard, {
          choreInstanceId: instance.id,
          childId: child.id,
          idempotencyKey: randomUUID(),
        }),
      () => clock.set(new Date('2026-08-08T16:30:00.000Z')),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'INVALID_STATE' }),
    });
    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(stored).toMatchObject({ status: 'CLAIMED', submittedAt: null });
    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id));
    expect(transitions).toHaveLength(1);
  });

  it('rejects extension when its row-lock wait reaches the exact deadline', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    clock.set(new Date('2026-08-08T16:29:59.999Z'));

    const result = await runWhileInstanceRowIsLocked(
      testDatabase!,
      instance.id,
      () =>
        service.extend(parent, {
          choreInstanceId: instance.id,
          additionalMinutes: 15,
          idempotencyKey: randomUUID(),
        }),
      () => clock.set(new Date('2026-08-08T16:30:00.000Z')),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'INVALID_STATE' }),
    });
    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(stored).toMatchObject({
      status: 'CLAIMED',
      claimDeadlineAt: new Date('2026-08-08T16:30:00.000Z'),
    });
    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id));
    expect(transitions).toHaveLength(1);
  });

  it('rejects cancellation when its row-lock wait reaches the exact deadline', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    clock.set(new Date('2026-08-08T16:29:59.999Z'));

    const result = await runWhileInstanceRowIsLocked(
      testDatabase!,
      instance.id,
      () =>
        service.cancel(parent, {
          choreInstanceId: instance.id,
          idempotencyKey: randomUUID(),
        }),
      () => clock.set(new Date('2026-08-08T16:30:00.000Z')),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'INVALID_STATE' }),
    });
    const [stored] = await testDatabase!.database
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(stored).toMatchObject({
      status: 'CLAIMED',
      claimedByChildId: child.id,
      claimDeadlineAt: new Date('2026-08-08T16:30:00.000Z'),
    });
    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id));
    expect(transitions).toHaveLength(1);
  });

  it('submits the claimant chore and records the dashboard transition', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    clock.set(new Date('2026-08-08T16:10:00.000Z'));

    const submitted = await service.submit(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });

    expect(submitted).toMatchObject({
      status: 'AWAITING_APPROVAL',
      claimedChildId: child.id,
      submittedAt: '2026-08-08T16:10:00.000Z',
    });
    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id))
      .orderBy(asc(choreTransitions.createdAt));
    expect(transitions).toEqual([
      expect.objectContaining({
        fromStatus: 'AVAILABLE',
        toStatus: 'CLAIMED',
        actorRole: 'DASHBOARD',
        actorParentId: null,
        actorDashboardDeviceId: dashboard.actorId,
      }),
      expect.objectContaining({
        fromStatus: 'CLAIMED',
        toStatus: 'AWAITING_APPROVAL',
        actorRole: 'DASHBOARD',
        actorParentId: null,
        actorDashboardDeviceId: dashboard.actorId,
      }),
    ]);
  });

  it('lets a parent extend or cancel an active claim', async () => {
    clock.set(initialNow);
    const { child, parent, dashboard, household } = await fixtures.household();
    const instance = await publishDefault(service, parent, household.id);
    const claimed = await service.claim(dashboard, {
      choreInstanceId: instance.id,
      childId: child.id,
      idempotencyKey: randomUUID(),
    });
    expect(claimed.claimDeadlineAt).toBe('2026-08-08T16:30:00.000Z');

    clock.set(new Date('2026-08-08T16:05:00.000Z'));
    const extended = await service.extend(parent, {
      choreInstanceId: instance.id,
      additionalMinutes: 15,
      reason: 'Needs a little longer',
      idempotencyKey: randomUUID(),
    });
    expect(extended.claimDeadlineAt).toBe('2026-08-08T16:45:00.000Z');

    const cancelled = await service.cancel(parent, {
      choreInstanceId: instance.id,
      reason: 'Dinner is ready',
      idempotencyKey: randomUUID(),
    });
    expect(cancelled).toMatchObject({
      status: 'AVAILABLE',
      claimedChildId: null,
      claimDeadlineAt: null,
    });

    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id))
      .orderBy(asc(choreTransitions.createdAt), asc(choreTransitions.id));
    expect(transitions).toHaveLength(3);
    expect(transitions).toEqual([
      expect.objectContaining({
        fromStatus: 'AVAILABLE',
        toStatus: 'CLAIMED',
        actorRole: 'DASHBOARD',
        actorParentId: null,
        actorDashboardDeviceId: dashboard.actorId,
      }),
      expect.objectContaining({
        fromStatus: 'CLAIMED',
        toStatus: 'CLAIMED',
        actorRole: 'PARENT',
        actorParentId: parent.actorId,
        actorDashboardDeviceId: null,
        reason: 'Needs a little longer',
      }),
      expect.objectContaining({
        fromStatus: 'CLAIMED',
        toStatus: 'AVAILABLE',
        actorRole: 'PARENT',
        actorParentId: parent.actorId,
        actorDashboardDeviceId: null,
        reason: 'Dinner is ready',
      }),
    ]);
  });

  it('prevents a dashboard from creating templates or publishing chores', async () => {
    const { parent, dashboard, household } = await fixtures.household();

    await expect(
      service.createTemplate(dashboard, {
        householdId: household.id,
        name: 'Not allowed',
        imageKey: 'tidy-toys',
        instructions: 'A dashboard cannot make this.',
        defaultValueCents: 100,
        defaultDurationMinutes: 10,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const template = await createTemplate(service, parent, household.id);
    await expect(
      service.publish(dashboard, {
        householdId: household.id,
        choreTemplateId: template.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents a parent from claiming or submitting chores', async () => {
    const { child, parent } = await fixtures.household();
    const choreInstanceId = randomUUID();

    await expect(
      service.claim(parent, {
        choreInstanceId,
        childId: child.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.submit(parent, {
        choreInstanceId,
        childId: child.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents a dashboard from extending or cancelling claims', async () => {
    const { dashboard } = await fixtures.household();
    const choreInstanceId = randomUUID();

    await expect(
      service.extend(dashboard, {
        choreInstanceId,
        additionalMinutes: 10,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.cancel(dashboard, {
        choreInstanceId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lists only available chores and hides cross-household identifiers', async () => {
    clock.set(initialNow);
    const first = await fixtures.household();
    const second = await fixtures.household();
    const firstInstance = await publishDefault(
      service,
      first.parent,
      first.household.id,
    );
    const secondInstance = await publishDefault(
      service,
      second.parent,
      second.household.id,
    );

    await expect(service.listAvailable(first.dashboard)).resolves.toEqual([
      expect.objectContaining({ id: firstInstance.id, status: 'AVAILABLE' }),
    ]);
    await expect(service.listAvailable(first.parent)).resolves.toEqual([
      expect.objectContaining({ id: firstInstance.id, status: 'AVAILABLE' }),
    ]);
    await expect(
      service.claim(first.dashboard, {
        choreInstanceId: secondInstance.id,
        childId: first.child.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

async function createTemplate(
  service: ChoreService,
  parent: Extract<ActorContext, { role: 'PARENT' }>,
  householdId: string,
) {
  return service.createTemplate(parent, {
    householdId,
    name: 'Default chore',
    imageKey: 'tidy-toys',
    instructions: 'Complete the chore.',
    defaultValueCents: 300,
    defaultDurationMinutes: 30,
    idempotencyKey: randomUUID(),
  });
}

async function publishDefault(
  service: ChoreService,
  parent: Extract<ActorContext, { role: 'PARENT' }>,
  householdId: string,
) {
  const template = await createTemplate(service, parent, householdId);
  return service.publish(parent, {
    householdId,
    choreTemplateId: template.id,
    idempotencyKey: randomUUID(),
  });
}
