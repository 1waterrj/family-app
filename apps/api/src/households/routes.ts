import {
  ChildProfileSchema,
  CreateChildSchema,
  CreateHouseholdSchema,
  HouseholdSchema,
} from '@family/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { assertHousehold } from '../auth/actor-context.js';
import {
  bodyRecord,
  commandPath,
  parseRequest,
  requestActor,
} from '../http.js';
import type { HouseholdService } from './service.js';

export interface HouseholdRoutesOptions {
  householdService: HouseholdService;
}

export const householdRoutes: FastifyPluginAsync<
  HouseholdRoutesOptions
> = async (app, { householdService }) => {
  app.post('/households', async (request, reply) => {
    const actor = requestActor(request);
    const command = parseRequest(
      CreateHouseholdSchema,
      {
        ...bodyRecord(request.body),
        idempotencyKey: request.headers['idempotency-key'],
      },
      commandPath,
    );
    const household = await householdService.createHousehold(actor, command);
    return reply.code(201).send(HouseholdSchema.parse(household));
  });

  app.post('/children', async (request, reply) => {
    const actor = requestActor(request);
    const input = parseRequest(
      CreateChildSchema,
      {
        ...bodyRecord(request.body),
        idempotencyKey: request.headers['idempotency-key'],
      },
      commandPath,
    );
    assertHousehold(actor, input.householdId);
    const command = {
      name: input.name,
      color: input.color,
      imageUrl: input.imageUrl,
      idempotencyKey: input.idempotencyKey,
    };
    const child = await householdService.createChild(actor, command);
    return reply.code(201).send(ChildProfileSchema.parse(child));
  });
};
