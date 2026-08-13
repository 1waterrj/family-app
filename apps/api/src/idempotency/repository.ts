import { and, eq } from 'drizzle-orm';

import type { ActorContext } from '../auth/actor-context.js';
import { idempotencyRecords } from '../db/schema.js';
import type { DatabaseTransaction } from '../db/transaction.js';

export interface StoredIdempotencyResponse {
  actor: ActorContext;
  createdAt: Date;
  idempotencyKey: string;
  operation: string;
  requestHash: string;
  response: unknown;
}

export class IdempotencyRepository {
  async find(
    transaction: DatabaseTransaction,
    householdId: string,
    idempotencyKey: string,
  ) {
    const [record] = await transaction
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.householdId, householdId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return record;
  }

  async insert(
    transaction: DatabaseTransaction,
    householdId: string,
    record: StoredIdempotencyResponse,
  ): Promise<void> {
    await transaction.insert(idempotencyRecords).values({
      householdId,
      idempotencyKey: record.idempotencyKey,
      actorRole: record.actor.role,
      actorParentId:
        record.actor.role === 'PARENT' ? record.actor.actorId : null,
      actorDashboardDeviceId:
        record.actor.role === 'DASHBOARD' ? record.actor.actorId : null,
      operation: record.operation,
      requestHash: record.requestHash,
      response: record.response,
      createdAt: record.createdAt,
    });
  }
}
