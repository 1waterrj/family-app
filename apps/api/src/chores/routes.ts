import {
  ApproveChoreSchema,
  CancelChoreClaimSchema,
  ChoreDecisionResultSchema,
  ChoreInstanceIdSchema,
  ChoreInstanceSchema,
  ChoreSubmissionResultSchema,
  ChoreTemplateSchema,
  ClaimChoreSchema,
  CreateChoreTemplateSchema,
  ExtendChoreClaimSchema,
  PublishChoreInstanceSchema,
  RejectChoreSchema,
  SubmitChoreSchema,
} from '@family/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ChoreService } from './service.js';
import {
  bodyRecord,
  commandPath,
  parseRequest,
  requestActor,
  requestPath,
} from '../http.js';

export interface ChoreRoutesOptions {
  choreService: ChoreService;
}

const idParamsSchema = z.object({ id: ChoreInstanceIdSchema });
const availableQuerySchema = z.object({ status: z.literal('AVAILABLE') });

export const choreRoutes: FastifyPluginAsync<ChoreRoutesOptions> = async (
  app,
  { choreService },
) => {
  app.post('/chore-templates', async (request, reply) => {
    const actor = requestActor(request);
    const command = parseRequest(
      CreateChoreTemplateSchema,
      {
        ...bodyRecord(request.body),
        idempotencyKey: request.headers['idempotency-key'],
      },
      commandPath,
    );
    const template = await choreService.createTemplate(actor, command);
    return reply.code(201).send(ChoreTemplateSchema.parse(template));
  });

  app.post('/chore-instances', async (request, reply) => {
    const actor = requestActor(request);
    const command = parseRequest(
      PublishChoreInstanceSchema,
      {
        ...bodyRecord(request.body),
        idempotencyKey: request.headers['idempotency-key'],
      },
      commandPath,
    );
    const instance = await choreService.publish(actor, command);
    return reply.code(201).send(ChoreInstanceSchema.parse(instance));
  });

  app.get('/chore-instances', async (request) => {
    const actor = requestActor(request);
    parseRequest(availableQuerySchema, request.query, requestPath('query'));
    const instances = await choreService.listAvailable(actor);
    return z.array(ChoreInstanceSchema).parse(instances);
  });

  app.post('/chore-instances/:id/claim', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, ClaimChoreSchema);
    return ChoreInstanceSchema.parse(await choreService.claim(actor, command));
  });

  app.post('/chore-instances/:id/submit', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, SubmitChoreSchema);
    return ChoreSubmissionResultSchema.parse(
      await choreService.submit(actor, command),
    );
  });

  app.post('/chore-instances/:id/extend', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, ExtendChoreClaimSchema);
    return ChoreInstanceSchema.parse(await choreService.extend(actor, command));
  });

  app.post('/chore-instances/:id/cancel', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, CancelChoreClaimSchema);
    return ChoreInstanceSchema.parse(await choreService.cancel(actor, command));
  });

  app.post('/chore-instances/:id/approve', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, ApproveChoreSchema);
    return toDecisionResponse(await choreService.approve(actor, command));
  });

  app.post('/chore-instances/:id/reject', async (request) => {
    const actor = requestActor(request);
    const command = parseCommand(request, RejectChoreSchema);
    return toDecisionResponse(await choreService.reject(actor, command));
  });
};

function parseCommand<T>(request: FastifyRequest, schema: z.ZodType<T>): T {
  const { id } = parseRequest(
    idParamsSchema,
    request.params,
    requestPath('path'),
  );
  return parseRequest(
    schema,
    {
      ...bodyRecord(request.body),
      choreInstanceId: id,
      idempotencyKey: request.headers['idempotency-key'],
    },
    commandPath,
  );
}

function toDecisionResponse(
  result: Awaited<ReturnType<ChoreService['approve']>>,
) {
  return ChoreDecisionResultSchema.parse({
    decisionId: result.decisionId,
    submissionAttemptId: result.submissionAttemptId,
    decision: result.decision,
    payoutCents: result.payoutCents,
    note: result.note,
    choreInstance: result,
  });
}
