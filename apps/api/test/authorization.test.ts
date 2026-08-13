import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertHousehold,
  requireDashboard,
  requireParent,
} from '../src/auth/actor-context.js';
import { HouseholdService } from '../src/households/service.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

describe('household authorization', () => {
  let database: TestDatabase | undefined;
  let fixtures: Fixtures;
  let service: HouseholdService;

  beforeAll(async () => {
    database = await startTestDatabase();
    fixtures = createFixtures(database.database);
    service = new HouseholdService(database.database);
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('prevents a parent from reading another household child', async () => {
    const { parent: firstParent } = await fixtures.household();
    const { child: secondChild } = await fixtures.household();

    await expect(
      service.getChild(firstParent, secondChild.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets a parent read a child in their own household', async () => {
    const { child, parent } = await fixtures.household();

    await expect(service.getChild(parent, child.id)).resolves.toMatchObject({
      householdId: parent.householdId,
      id: child.id,
    });
  });

  it('prevents a dashboard from making parent mutations', async () => {
    const { dashboard } = await fixtures.household();

    await expect(
      service.createChild(dashboard, {
        color: 'purple',
        name: 'Riley',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a dashboard actor from parent-only guards', async () => {
    const { dashboard } = await fixtures.household();

    expect(() => requireParent(dashboard)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects a parent actor from dashboard-only guards', async () => {
    const { parent } = await fixtures.household();

    expect(() => requireDashboard(parent)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('does not disclose another household through assertHousehold', async () => {
    const { parent } = await fixtures.household();
    const { household } = await fixtures.household();

    expect(() => assertHousehold(parent, household.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
