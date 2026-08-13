import {
  LedgerTransactionSchema,
  type LedgerTransactionType,
} from '@family/contracts';

import {
  ActorContextError,
  type ActorContext,
  requireParent,
} from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import { IdempotentCommandExecutor } from '../idempotency/executor.js';
import { LedgerRepository } from './repository.js';

export interface RecordManualLedgerEntryInput {
  childId: string;
  amountCents: number;
  type: LedgerTransactionType;
  note: string;
  idempotencyKey: string;
}

export class LedgerServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerServiceError';
  }

  readonly code = 'VALIDATION_ERROR' as const;
}

export class LedgerService {
  private readonly repository: LedgerRepository;

  constructor(
    private readonly database: Database,
    repository = new LedgerRepository(),
    private readonly idempotency = new IdempotentCommandExecutor(database),
  ) {
    this.repository = repository;
  }

  async getBalance(actor: ActorContext, childId: string) {
    const balanceCents = await this.database.transaction(
      async (transaction) => {
        await requireChild(this.repository, transaction, actor, childId);
        return toSafeInteger(
          await this.repository.sumByChild(
            transaction,
            actor.householdId,
            childId,
          ),
        );
      },
    );

    return { balanceCents };
  }

  async listTransactions(actor: ActorContext, childId: string) {
    const parent = requireParent(actor);
    const entries = await this.database.transaction(async (transaction) => {
      await requireChild(this.repository, transaction, parent, childId);
      return this.repository.listByChild(
        transaction,
        parent.householdId,
        childId,
      );
    });

    return entries.map(toLedgerTransaction);
  }

  async getSummary(actor: ActorContext, childId: string) {
    const parent = requireParent(actor);

    return this.database.transaction(
      async (transaction) => {
        await requireChild(this.repository, transaction, parent, childId);
        const entries = await this.repository.listByChild(
          transaction,
          parent.householdId,
          childId,
        );
        const balanceCents = toSafeInteger(
          await this.repository.sumByChild(
            transaction,
            parent.householdId,
            childId,
          ),
        );

        return {
          householdId: parent.householdId,
          childId,
          balanceCents,
          transactions: entries.map(toLedgerTransaction),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async recordManualEntry(
    actor: ActorContext,
    input: RecordManualLedgerEntryInput,
  ) {
    const parent = requireParent(actor);
    validateManualEntry(input);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'RECORD_MANUAL_LEDGER_ENTRY',
      request: input,
      responseSchema: LedgerTransactionSchema,
      work: async (transaction) => {
        await requireChild(this.repository, transaction, parent, input.childId);
        const entry = await this.repository.insert(
          transaction,
          parent.householdId,
          {
            childId: input.childId,
            amountCents: input.amountCents,
            type: input.type,
            note: input.note.trim(),
            actorParentId: parent.actorId,
            relatedChoreInstanceId: null,
            approvalDecisionId: null,
          },
        );
        return toLedgerTransaction(entry);
      },
    });
  }
}

async function requireChild(
  repository: LedgerRepository,
  transaction: Parameters<LedgerRepository['findChild']>[0],
  actor: ActorContext,
  childId: string,
) {
  const child = await repository.findChild(
    transaction,
    actor.householdId,
    childId,
  );
  if (!child) {
    throw new ActorContextError('NOT_FOUND', 'Resource not found.');
  }

  return child;
}

function validateManualEntry(input: RecordManualLedgerEntryInput): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) {
    throw new LedgerServiceError('Amount must be a non-zero safe integer.');
  }
  if (input.note.trim().length === 0 || input.note.trim().length > 500) {
    throw new LedgerServiceError(
      'A nonblank note of at most 500 characters is required.',
    );
  }

  if (
    (input.type === 'MANUAL_CREDIT' && input.amountCents > 0) ||
    (input.type === 'PURCHASE' && input.amountCents < 0) ||
    input.type === 'CORRECTION'
  ) {
    return;
  }

  throw new LedgerServiceError(
    'Manual entries must use a permitted category with a matching sign.',
  );
}

function toSafeInteger(value: string | number): number {
  const integer = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(integer)) {
    throw new LedgerServiceError(
      'Ledger balance exceeds JavaScript safe integer range.',
    );
  }

  return integer;
}

function toLedgerTransaction(
  transaction: typeof import('../db/schema.js').ledgerTransactions.$inferSelect,
) {
  return LedgerTransactionSchema.parse({
    id: transaction.id,
    householdId: transaction.householdId,
    childId: transaction.childId,
    amountCents: transaction.amountCents,
    type: transaction.type,
    note: transaction.note,
    actorParentId: transaction.actorParentId,
    relatedChoreInstanceId: transaction.relatedChoreInstanceId,
    approvalDecisionId: transaction.approvalDecisionId,
    createdAt: transaction.createdAt.toISOString(),
  });
}
