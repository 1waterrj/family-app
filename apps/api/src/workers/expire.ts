import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { choreInstances, choreTransitions } from '../db/schema.js';

const minimumBatchSize = 1;
const maximumBatchSize = 500;

export async function expireClaimedChores(
  db: Database,
  now: Date,
  batchSize: number,
): Promise<number> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < minimumBatchSize ||
    batchSize > maximumBatchSize
  ) {
    throw new RangeError(
      `batchSize must be an integer between ${minimumBatchSize} and ${maximumBatchSize}.`,
    );
  }

  return db.transaction(async (transaction) => {
    const dueChores = await transaction
      .select({
        id: choreInstances.id,
        householdId: choreInstances.householdId,
      })
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.status, 'CLAIMED'),
          lte(choreInstances.claimDeadlineAt, now),
        ),
      )
      .orderBy(asc(choreInstances.claimDeadlineAt), asc(choreInstances.id))
      .limit(batchSize)
      .for('update', { skipLocked: true });

    if (dueChores.length === 0) {
      return 0;
    }

    const choreInstanceIds = dueChores.map((chore) => chore.id);
    await transaction
      .update(choreInstances)
      .set({
        status: 'AVAILABLE',
        claimedByChildId: null,
        claimDeadlineAt: null,
        submittedAt: null,
      })
      .where(inArray(choreInstances.id, choreInstanceIds));
    await transaction.insert(choreTransitions).values(
      dueChores.map((chore) => ({
        householdId: chore.householdId,
        choreInstanceId: chore.id,
        fromStatus: 'CLAIMED' as const,
        toStatus: 'AVAILABLE' as const,
        actorRole: 'SYSTEM' as const,
        actorParentId: null,
        actorDashboardDeviceId: null,
        reason: 'EXPIRED',
        createdAt: now,
      })),
    );

    return dueChores.length;
  });
}
