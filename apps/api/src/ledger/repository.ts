import { and, asc, eq, sql } from 'drizzle-orm';

import type { LedgerTransactionType } from '@family/contracts';

import { childProfiles, ledgerTransactions } from '../db/schema.js';
import type { DatabaseTransaction } from '../db/transaction.js';

export interface InsertLedgerTransactionRecord {
  childId: string;
  amountCents: number;
  type: LedgerTransactionType;
  note: string | null;
  actorParentId: string | null;
  relatedChoreInstanceId: string | null;
  approvalDecisionId: string | null;
  createdAt?: Date;
}

export interface InsertChoreCreditRecord {
  childId: string;
  amountCents: number;
  note: string | null;
  actorParentId: string;
  relatedChoreInstanceId: string;
  approvalDecisionId: string;
  createdAt: Date;
}

export class LedgerRepository {
  async findChild(
    transaction: DatabaseTransaction,
    householdId: string,
    childId: string,
  ) {
    const [child] = await transaction
      .select()
      .from(childProfiles)
      .where(
        and(
          eq(childProfiles.householdId, householdId),
          eq(childProfiles.id, childId),
        ),
      )
      .limit(1);

    return child;
  }

  async insert(
    transaction: DatabaseTransaction,
    householdId: string,
    record: InsertLedgerTransactionRecord,
  ) {
    const [entry] = await transaction
      .insert(ledgerTransactions)
      .values({ householdId, ...record })
      .returning();

    return entry;
  }

  async insertChoreCredit(
    transaction: DatabaseTransaction,
    householdId: string,
    record: InsertChoreCreditRecord,
  ) {
    return this.insert(transaction, householdId, {
      ...record,
      type: 'CHORE_CREDIT',
    });
  }

  async listByChild(
    transaction: DatabaseTransaction,
    householdId: string,
    childId: string,
  ) {
    return transaction
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.householdId, householdId),
          eq(ledgerTransactions.childId, childId),
        ),
      )
      .orderBy(asc(ledgerTransactions.createdAt), asc(ledgerTransactions.id));
  }

  async sumByChild(
    transaction: DatabaseTransaction,
    householdId: string,
    childId: string,
  ) {
    const [result] = await transaction
      .select({
        balanceCents: sql<string>`coalesce(sum(${ledgerTransactions.amountCents}), 0)::bigint`,
      })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.householdId, householdId),
          eq(ledgerTransactions.childId, childId),
        ),
      );

    return result?.balanceCents ?? '0';
  }
}
