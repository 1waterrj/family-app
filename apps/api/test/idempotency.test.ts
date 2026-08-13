import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActorContext } from '../src/auth/actor-context.js';
import { ChoreService, type Clock } from '../src/chores/service.js';
import {
  childProfiles,
  choreInstances,
  choreSubmissionAttempts,
  choreTemplates,
  choreTransitions,
  households,
  idempotencyRecords,
  ledgerTransactions,
  parentMemberships,
} from '../src/db/schema.js';
import { HouseholdService } from '../src/households/service.js';
import { LedgerService } from '../src/ledger/service.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-08-09T12:00:00.000Z');
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

describe('all mutation idempotency', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let householdsService: HouseholdService;
  let chores: ChoreService;
  let ledger: LedgerService;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    householdsService = new HouseholdService(testDatabase.database);
    chores = new ChoreService(testDatabase.database, new FixedClock());
    ledger = new LedgerService(testDatabase.database);
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('creates a bootstrap household, membership, and replay record atomically', async () => {
    const actor: Extract<ActorContext, { role: 'PARENT' }> = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: randomUUID(),
    };
    const command = {
      name: 'Bootstrap household',
      timeZone: 'America/New_York',
      idempotencyKey: randomUUID(),
    };

    const original = await householdsService.createHousehold(actor, command);
    const replay = await householdsService.createHousehold(actor, command);

    expect(replay).toEqual(original);
    await expect(
      testDatabase!.database
        .select()
        .from(households)
        .where(eq(households.id, actor.householdId)),
    ).resolves.toHaveLength(1);
    await expect(
      testDatabase!.database
        .select()
        .from(parentMemberships)
        .where(eq(parentMemberships.householdId, actor.householdId)),
    ).resolves.toHaveLength(1);
    await expect(recordsFor(actor.householdId)).resolves.toEqual([
      expect.objectContaining({
        operation: 'CREATE_HOUSEHOLD',
        response: original,
      }),
    ]);
  });

  it('rolls back bootstrap identity when replay persistence fails', async () => {
    const actor: Extract<ActorContext, { role: 'PARENT' }> = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: randomUUID(),
    };

    await testDatabase!.sql.unsafe(`
      CREATE FUNCTION test_fail_bootstrap_idempotency() RETURNS trigger AS $$
      BEGIN
        IF NEW.operation = 'CREATE_HOUSEHOLD' THEN
          RAISE EXCEPTION 'forced bootstrap idempotency failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_bootstrap_idempotency
      BEFORE INSERT ON idempotency_records
      FOR EACH ROW EXECUTE FUNCTION test_fail_bootstrap_idempotency();
    `);

    try {
      await expect(
        householdsService.createHousehold(actor, {
          name: 'Must roll back',
          timeZone: 'America/New_York',
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ cause: { code: 'P0001' } });
    } finally {
      await testDatabase!.sql.unsafe(`
        DROP TRIGGER IF EXISTS test_fail_bootstrap_idempotency ON idempotency_records;
        DROP FUNCTION IF EXISTS test_fail_bootstrap_idempotency();
      `);
    }

    await expect(
      testDatabase!.database
        .select()
        .from(households)
        .where(eq(households.id, actor.householdId)),
    ).resolves.toHaveLength(0);
    await expect(
      testDatabase!.database
        .select()
        .from(parentMemberships)
        .where(eq(parentMemberships.householdId, actor.householdId)),
    ).resolves.toHaveLength(0);
  });

  it('returns one child for concurrent same-key creation', async () => {
    const { parent } = await fixtures.household();
    const idempotencyKey = randomUUID();
    const waitAtBarrier = createBarrier(2);
    const create = async () => {
      await waitAtBarrier();
      return householdsService.createChild(parent, {
        name: 'Concurrent child',
        color: 'purple',
        idempotencyKey,
      });
    };

    const results = await Promise.all([create(), create()]);

    expect(results[0]).toEqual(results[1]);
    await expect(
      testDatabase!.database
        .select()
        .from(childProfiles)
        .where(
          and(
            eq(childProfiles.householdId, parent.householdId),
            eq(childProfiles.name, 'Concurrent child'),
          ),
        ),
    ).resolves.toHaveLength(1);
    await expect(recordsFor(parent.householdId)).resolves.toEqual([
      expect.objectContaining({ operation: 'CREATE_CHILD' }),
    ]);
  });

  it('replays template creation and publication without duplicate rows', async () => {
    const { household, parent } = await fixtures.household();
    const templateCommand = {
      householdId: household.id,
      name: 'Idempotent template',
      imageKey: 'tidy-toys' as const,
      instructions: 'Do this exactly once.',
      defaultValueCents: 200,
      defaultDurationMinutes: 20,
      idempotencyKey: randomUUID(),
    };
    const originalTemplate = await chores.createTemplate(
      parent,
      templateCommand,
    );
    const replayedTemplate = await chores.createTemplate(
      parent,
      templateCommand,
    );
    const publishCommand = {
      householdId: household.id,
      choreTemplateId: originalTemplate.id,
      idempotencyKey: randomUUID(),
    };
    const originalInstance = await chores.publish(parent, publishCommand);
    const replayedInstance = await chores.publish(parent, publishCommand);

    expect(replayedTemplate).toEqual(originalTemplate);
    expect(replayedInstance).toEqual(originalInstance);
    await expect(
      testDatabase!.database
        .select()
        .from(choreTemplates)
        .where(eq(choreTemplates.id, originalTemplate.id)),
    ).resolves.toHaveLength(1);
    await expect(
      testDatabase!.database
        .select()
        .from(choreInstances)
        .where(eq(choreInstances.id, originalInstance.id)),
    ).resolves.toHaveLength(1);
  });

  it('replays a claim and submission without duplicate transitions or attempts', async () => {
    const setup = await fixtures.household();
    const instance = await createAvailableChore(setup, 'Claim replay');
    const claimCommand = {
      choreInstanceId: instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    };
    const originalClaim = await chores.claim(setup.dashboard, claimCommand);
    const replayedClaim = await chores.claim(setup.dashboard, claimCommand);
    const submitCommand = {
      choreInstanceId: instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    };
    const originalSubmission = await chores.submit(
      setup.dashboard,
      submitCommand,
    );
    const replayedSubmission = await chores.submit(
      setup.dashboard,
      submitCommand,
    );

    expect(replayedClaim).toEqual(originalClaim);
    expect(replayedSubmission).toEqual(originalSubmission);
    expect(originalSubmission).toMatchObject({
      submissionAttemptId: expect.any(String),
    });
    await expect(
      testDatabase!.database
        .select()
        .from(choreSubmissionAttempts)
        .where(eq(choreSubmissionAttempts.choreInstanceId, instance.id)),
    ).resolves.toHaveLength(1);
    const transitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, instance.id));
    expect(
      transitions.filter(({ toStatus }) => toStatus === 'CLAIMED'),
    ).toHaveLength(1);
    expect(
      transitions.filter(({ toStatus }) => toStatus === 'AWAITING_APPROVAL'),
    ).toHaveLength(1);
  });

  it('replays extension and cancellation without repeated state changes', async () => {
    const setup = await fixtures.household();
    const extendedInstance = await createClaimedChore(setup, 'Extend replay');
    const extendCommand = {
      choreInstanceId: extendedInstance.id,
      additionalMinutes: 5,
      reason: 'Five more minutes',
      idempotencyKey: randomUUID(),
    };
    const originalExtension = await chores.extend(setup.parent, extendCommand);
    const replayedExtension = await chores.extend(setup.parent, extendCommand);

    expect(replayedExtension).toEqual(originalExtension);

    const cancelledInstance = await createClaimedChore(setup, 'Cancel replay');
    const cancelCommand = {
      choreInstanceId: cancelledInstance.id,
      reason: 'Stop this claim',
      idempotencyKey: randomUUID(),
    };
    const originalCancellation = await chores.cancel(
      setup.parent,
      cancelCommand,
    );
    const replayedCancellation = await chores.cancel(
      setup.parent,
      cancelCommand,
    );

    expect(replayedCancellation).toEqual(originalCancellation);
    const extensionTransitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, extendedInstance.id));
    expect(
      extensionTransitions.filter(
        ({ fromStatus, toStatus }) =>
          fromStatus === 'CLAIMED' && toStatus === 'CLAIMED',
      ),
    ).toHaveLength(1);
    const cancellationTransitions = await testDatabase!.database
      .select()
      .from(choreTransitions)
      .where(eq(choreTransitions.choreInstanceId, cancelledInstance.id));
    expect(
      cancellationTransitions.filter(
        ({ fromStatus, toStatus }) =>
          fromStatus === 'CLAIMED' && toStatus === 'AVAILABLE',
      ),
    ).toHaveLength(1);
  });

  it('replays a manual ledger entry without duplicating money', async () => {
    const { child, parent } = await fixtures.household();
    const command = {
      childId: child.id,
      amountCents: 500,
      type: 'MANUAL_CREDIT' as const,
      note: 'Opening balance',
      idempotencyKey: randomUUID(),
    };

    const original = await ledger.recordManualEntry(parent, command);
    const replayed = await ledger.recordManualEntry(parent, command);

    expect(replayed).toEqual(original);
    await expect(ledger.getBalance(parent, child.id)).resolves.toEqual({
      balanceCents: 500,
    });
    await expect(
      testDatabase!.database
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.childId, child.id)),
    ).resolves.toHaveLength(1);
  });

  it('rejects same-household key reuse across operations', async () => {
    const { household, parent } = await fixtures.household();
    const idempotencyKey = randomUUID();

    await householdsService.createChild(parent, {
      name: 'First operation',
      color: 'blue',
      idempotencyKey,
    });

    await expect(
      chores.createTemplate(parent, {
        householdId: household.id,
        name: 'Conflicting operation',
        imageKey: 'tidy-toys',
        instructions: 'This must not be created.',
        defaultValueCents: 100,
        defaultDurationMinutes: 10,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects same-household key reuse by another actor', async () => {
    const { household, parent } = await fixtures.household();
    const secondParent: Extract<ActorContext, { role: 'PARENT' }> = {
      role: 'PARENT',
      actorId: randomUUID(),
      householdId: household.id,
    };
    await testDatabase!.database.insert(parentMemberships).values({
      householdId: household.id,
      parentId: secondParent.actorId,
    });
    const command = {
      name: 'Actor-owned operation',
      color: 'blue',
      idempotencyKey: randomUUID(),
    };

    await householdsService.createChild(parent, command);

    await expect(
      householdsService.createChild(secondParent, command),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  async function recordsFor(householdId: string) {
    return testDatabase!.database
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.householdId, householdId));
  }

  async function createAvailableChore(
    setup: Awaited<ReturnType<Fixtures['household']>>,
    name: string,
  ) {
    const template = await chores.createTemplate(setup.parent, {
      householdId: setup.household.id,
      name,
      imageKey: 'tidy-toys',
      instructions: 'Complete this chore.',
      defaultValueCents: 250,
      defaultDurationMinutes: 30,
      idempotencyKey: randomUUID(),
    });
    return chores.publish(setup.parent, {
      householdId: setup.household.id,
      choreTemplateId: template.id,
      idempotencyKey: randomUUID(),
    });
  }

  async function createClaimedChore(
    setup: Awaited<ReturnType<Fixtures['household']>>,
    name: string,
  ) {
    const instance = await createAvailableChore(setup, name);
    return chores.claim(setup.dashboard, {
      choreInstanceId: instance.id,
      childId: setup.child.id,
      idempotencyKey: randomUUID(),
    });
  }
});
