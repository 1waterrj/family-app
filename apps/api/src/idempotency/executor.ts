import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ActorContext } from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import type { DatabaseTransaction } from '../db/transaction.js';
import { IdempotencyRepository } from './repository.js';

const maximumTransactionAttempts = 5;

type TransactionIsolationLevel = 'read committed' | 'serializable';

export interface IdempotentCommand<T> {
  actor: ActorContext;
  idempotencyKey: string;
  operation: string;
  request: unknown;
  responseSchema: z.ZodType<T>;
  isolationLevel?: TransactionIsolationLevel;
  authorize?(transaction: DatabaseTransaction): Promise<void>;
  work(transaction: DatabaseTransaction): Promise<T>;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotentCommandExecutor {
  constructor(
    private readonly database: Database,
    private readonly repository = new IdempotencyRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute<T>(command: IdempotentCommand<T>): Promise<T> {
    const requestHash = hashRequest(command.request);
    return this.runTransaction(async (transaction) => {
      await command.authorize?.(transaction);
      const stored = await this.repository.find(
        transaction,
        command.actor.householdId,
        command.idempotencyKey,
      );
      if (stored) {
        if (!belongsToActor(stored, command.actor)) {
          throw new IdempotencyConflictError(
            'The idempotency key belongs to another actor.',
          );
        }
        if (stored.operation !== command.operation) {
          throw new IdempotencyConflictError(
            'The idempotency key was used for another operation.',
          );
        }
        if (stored.requestHash !== requestHash) {
          throw new IdempotencyConflictError(
            'The idempotency key was used with another request payload.',
          );
        }
        if (stored.response === null) {
          throw new IdempotencyConflictError(
            'The idempotent operation has no stored response.',
          );
        }
        return command.responseSchema.parse(stored.response);
      }

      const response = command.responseSchema.parse(
        await command.work(transaction),
      );
      await this.repository.insert(transaction, command.actor.householdId, {
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        operation: command.operation,
        requestHash,
        response,
        createdAt: this.now(),
      });
      return response;
    }, command.isolationLevel ?? 'serializable');
  }

  private async runTransaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
    isolationLevel: TransactionIsolationLevel,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
      try {
        return await this.database.transaction(work, {
          isolationLevel,
        });
      } catch (error) {
        if (attempt === maximumTransactionAttempts || !isRetryable(error)) {
          throw error;
        }
      }
    }

    throw new Error('Transaction retry loop exhausted.');
  }
}

function belongsToActor(
  stored: {
    actorRole: string;
    actorParentId: string | null;
    actorDashboardDeviceId: string | null;
  },
  actor: ActorContext,
): boolean {
  return actor.role === 'PARENT'
    ? stored.actorRole === 'PARENT' && stored.actorParentId === actor.actorId
    : stored.actorRole === 'DASHBOARD' &&
        stored.actorDashboardDeviceId === actor.actorId;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableJson(input), 'utf8').digest('hex');
}

function stableJson(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map(stableJson).join(',')}]`;
  }
  if (input !== null && typeof input === 'object') {
    return `{${Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`)
      .join(',')}}`;
  }
  return JSON.stringify(input) ?? 'undefined';
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const databaseError = error as { cause?: unknown; code?: unknown };
  return (
    databaseError.code === '23505' ||
    databaseError.code === '40001' ||
    databaseError.code === '40P01' ||
    isRetryable(databaseError.cause)
  );
}
