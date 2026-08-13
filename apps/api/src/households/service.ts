import { and, eq } from 'drizzle-orm';

import {
  ActorContextError,
  type ActorContext,
  requireParent,
} from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import { childProfiles, households, parentMemberships } from '../db/schema.js';
import {
  type CreateChild,
  ChildProfileSchema,
  type CreateHousehold,
  HouseholdSchema,
} from '@family/contracts';
import { IdempotentCommandExecutor } from '../idempotency/executor.js';

export type CreateChildInput = Omit<CreateChild, 'householdId'>;

export class HouseholdService {
  constructor(
    private readonly database: Database,
    private readonly idempotency = new IdempotentCommandExecutor(database),
  ) {}

  async createHousehold(actor: ActorContext, input: CreateHousehold) {
    const parent = requireParent(actor);
    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'CREATE_HOUSEHOLD',
      request: input,
      responseSchema: HouseholdSchema,
      work: async (transaction) => {
        const [created] = await transaction
          .insert(households)
          .values({
            id: parent.householdId,
            name: input.name,
            timeZone: input.timeZone,
          })
          .returning();
        await transaction.insert(parentMemberships).values({
          householdId: parent.householdId,
          parentId: parent.actorId,
        });

        return HouseholdSchema.parse({
          ...created,
          createdAt: created!.createdAt.toISOString(),
        });
      },
    });
  }

  async getHousehold(actor: ActorContext) {
    const [household] = await this.database
      .select()
      .from(households)
      .where(eq(households.id, actor.householdId))
      .limit(1);

    if (!household) {
      throw new ActorContextError('NOT_FOUND', 'Resource not found.');
    }

    return household;
  }

  async getChild(actor: ActorContext, childId: string) {
    const [child] = await this.database
      .select()
      .from(childProfiles)
      .where(
        and(
          eq(childProfiles.householdId, actor.householdId),
          eq(childProfiles.id, childId),
        ),
      )
      .limit(1);

    if (!child) {
      throw new ActorContextError('NOT_FOUND', 'Resource not found.');
    }

    return child;
  }

  async createChild(actor: ActorContext, input: CreateChildInput) {
    const parent = requireParent(actor);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'CREATE_CHILD',
      request: input,
      responseSchema: ChildProfileSchema,
      work: async (transaction) => {
        const [child] = await transaction
          .insert(childProfiles)
          .values({
            householdId: parent.householdId,
            name: input.name,
            color: input.color,
            imageUrl: input.imageUrl,
          })
          .returning();

        return ChildProfileSchema.parse({
          ...child,
          createdAt: child!.createdAt.toISOString(),
        });
      },
    });
  }
}
