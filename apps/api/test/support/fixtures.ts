import { randomUUID } from 'node:crypto';

import type { ActorContext } from '../../src/auth/actor-context.js';
import type { Database } from '../../src/db/client.js';
import {
  childProfiles,
  dashboardDevices,
  households,
  parentMemberships,
} from '../../src/db/schema.js';

export interface HouseholdFixture {
  household: typeof households.$inferSelect;
  parent: Extract<ActorContext, { role: 'PARENT' }>;
  dashboard: Extract<ActorContext, { role: 'DASHBOARD' }>;
  child: typeof childProfiles.$inferSelect;
}

export interface Fixtures {
  household(options?: { childName?: string }): Promise<HouseholdFixture>;
  child(
    householdId: string,
    input: { name: string; color: string },
  ): Promise<typeof childProfiles.$inferSelect>;
}

export function createFixtures(database: Database): Fixtures {
  const createChild = async (
    householdId: string,
    input: { name: string; color: string },
  ) => {
    const [child] = await database
      .insert(childProfiles)
      .values({ householdId, ...input })
      .returning();
    return child!;
  };

  return {
    child: createChild,

    async household(options = {}): Promise<HouseholdFixture> {
      const householdId = randomUUID();
      const parentId = randomUUID();
      const dashboardId = randomUUID();

      const [household] = await database
        .insert(households)
        .values({
          id: householdId,
          name: 'Fixture household',
          timeZone: 'America/New_York',
        })
        .returning();

      await database.insert(parentMemberships).values({
        householdId,
        parentId,
      });

      await database.insert(dashboardDevices).values({
        id: dashboardId,
        householdId,
        name: 'Fixture dashboard',
      });

      const child = await createChild(householdId, {
        name: options.childName ?? 'Fixture child',
        color: 'blue',
      });

      return {
        household,
        parent: { role: 'PARENT', actorId: parentId, householdId },
        dashboard: { role: 'DASHBOARD', actorId: dashboardId, householdId },
        child,
      };
    },
  };
}
