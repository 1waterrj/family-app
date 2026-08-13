import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LedgerRepository } from '../src/ledger/repository.js';
import { LedgerService } from '../src/ledger/service.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

class PausedAfterLedgerListRepository extends LedgerRepository {
  private signalListed: (() => void) | undefined;
  private releaseList: (() => void) | undefined;
  private readonly listed = new Promise<void>((resolve) => {
    this.signalListed = resolve;
  });
  private readonly hold = new Promise<void>((resolve) => {
    this.releaseList = resolve;
  });

  waitUntilListed(): Promise<void> {
    return this.listed;
  }

  allowSummary(): void {
    this.releaseList?.();
  }

  override async listByChild(
    ...args: Parameters<LedgerRepository['listByChild']>
  ) {
    const entries = await super.listByChild(...args);
    this.signalListed?.();
    await this.hold;
    return entries;
  }
}

describe('immutable child reward ledger', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let ledger: LedgerService;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 4 });
    fixtures = createFixtures(testDatabase.database);
    ledger = new LedgerService(testDatabase.database);
  }, 60_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('calculates balance as the sum of signed integer cents', async () => {
    const { child, parent } = await fixtures.household();

    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: 500,
      type: 'MANUAL_CREDIT',
      note: 'Opening credit',
      idempotencyKey: randomUUID(),
    });
    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: -225,
      type: 'PURCHASE',
      note: 'Book purchase',
      idempotencyKey: randomUUID(),
    });

    await expect(ledger.getBalance(parent, child.id)).resolves.toEqual({
      balanceCents: 275,
    });
  });

  it('records both positive and negative corrections with parent attribution', async () => {
    const { child, parent } = await fixtures.household();

    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: 75,
      type: 'CORRECTION',
      note: 'Missed allowance',
      idempotencyKey: randomUUID(),
    });
    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: -25,
      type: 'CORRECTION',
      note: 'Duplicate allowance',
      idempotencyKey: randomUUID(),
    });

    await expect(ledger.listTransactions(parent, child.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountCents: 75,
          type: 'CORRECTION',
          actorParentId: parent.actorId,
          note: 'Missed allowance',
          relatedChoreInstanceId: null,
        }),
        expect.objectContaining({
          amountCents: -25,
          type: 'CORRECTION',
          actorParentId: parent.actorId,
          note: 'Duplicate allowance',
          relatedChoreInstanceId: null,
        }),
      ]),
    );
  });

  it.each([
    {
      amountCents: 100,
      type: 'PURCHASE' as const,
      note: 'Positive purchase',
    },
    {
      amountCents: -100,
      type: 'MANUAL_CREDIT' as const,
      note: 'Negative credit',
    },
    {
      amountCents: 0,
      type: 'CORRECTION' as const,
      note: 'Zero correction',
    },
    {
      amountCents: 100,
      type: 'CHORE_CREDIT' as const,
      note: 'Manual chore credit',
    },
  ])('rejects an invalid manual type or sign: $note', async (input) => {
    const { child, parent } = await fixtures.household();

    await expect(
      ledger.recordManualEntry(parent, {
        childId: child.id,
        idempotencyKey: randomUUID(),
        ...input,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a ledger type with an inconsistent sign at the database boundary', async () => {
    const { child, household, parent } = await fixtures.household();

    await expect(
      testDatabase!.sql`
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
          ${household.id},
          ${child.id},
          100,
          'PURCHASE',
          'Positive purchase',
          ${parent.actorId}
        )
      `,
    ).rejects.toThrow(/check/i);
  });

  it('requires a nonblank note for manual entries', async () => {
    const { child, parent } = await fixtures.household();

    await expect(
      ledger.recordManualEntry(parent, {
        childId: child.id,
        amountCents: 500,
        type: 'MANUAL_CREDIT',
        note: '   ',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('prevents dashboards from writing ledger entries', async () => {
    const { child, dashboard } = await fixtures.household();

    await expect(
      ledger.recordManualEntry(dashboard, {
        childId: child.id,
        amountCents: 500,
        type: 'MANUAL_CREDIT',
        note: 'Opening credit',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('has no update or delete operation for posted transactions', () => {
    expect(LedgerRepository.prototype).not.toHaveProperty('update');
    expect(LedgerRepository.prototype).not.toHaveProperty('delete');
    expect(LedgerService.prototype).not.toHaveProperty('update');
    expect(LedgerService.prototype).not.toHaveProperty('delete');
  });

  it('exposes only a balance to dashboards and reserves ledger detail for parents', async () => {
    const { child, dashboard, parent } = await fixtures.household();

    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: 425,
      type: 'MANUAL_CREDIT',
      note: 'Private parent note',
      idempotencyKey: randomUUID(),
    });

    await expect(ledger.getBalance(dashboard, child.id)).resolves.toEqual({
      balanceCents: 425,
    });
    await expect(
      ledger.listTransactions(dashboard, child.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ledger.getSummary(parent, child.id)).resolves.toMatchObject({
      balanceCents: 425,
      transactions: [expect.objectContaining({ note: 'Private parent note' })],
    });
  });

  it('returns ledger transactions and balance from one coherent snapshot', async () => {
    const { child, parent } = await fixtures.household();
    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: 100,
      type: 'MANUAL_CREDIT',
      note: 'First entry',
      idempotencyKey: randomUUID(),
    });
    const repository = new PausedAfterLedgerListRepository();
    const coherentLedger = new LedgerService(
      testDatabase!.database,
      repository,
    );
    const summary = coherentLedger.getSummary(parent, child.id);

    await repository.waitUntilListed();
    try {
      await ledger.recordManualEntry(parent, {
        childId: child.id,
        amountCents: 50,
        type: 'MANUAL_CREDIT',
        note: 'Concurrent entry',
        idempotencyKey: randomUUID(),
      });
    } finally {
      repository.allowSummary();
    }

    await expect(summary).resolves.toMatchObject({
      balanceCents: 100,
      transactions: [expect.objectContaining({ note: 'First entry' })],
    });
  });

  it('isolates ledger reads by household', async () => {
    const { child, parent } = await fixtures.household();
    const { parent: otherParent } = await fixtures.household();

    await ledger.recordManualEntry(parent, {
      childId: child.id,
      amountCents: 500,
      type: 'MANUAL_CREDIT',
      note: 'Opening credit',
      idempotencyKey: randomUUID(),
    });

    await expect(
      ledger.getBalance(otherParent, child.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      ledger.listTransactions(otherParent, child.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
