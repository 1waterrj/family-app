import {
  ChildIdSchema,
  LedgerBalanceSchema,
  LedgerSummarySchema,
  LedgerTransactionSchema,
  ManualLedgerEntrySchema,
} from '@family/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { assertHousehold } from '../auth/actor-context.js';
import {
  bodyRecord,
  parseRequest,
  requestActor,
  requestPath,
} from '../http.js';
import type { LedgerService } from './service.js';

export interface LedgerRoutesOptions {
  ledgerService: LedgerService;
}

const childParamsSchema = z.object({ id: ChildIdSchema });

export const ledgerRoutes: FastifyPluginAsync<LedgerRoutesOptions> = async (
  app,
  { ledgerService },
) => {
  app.get('/children/:id/ledger', async (request) => {
    const actor = requestActor(request);
    const { id } = parseRequest(
      childParamsSchema,
      request.params,
      requestPath('path'),
    );
    return LedgerSummarySchema.parse(await ledgerService.getSummary(actor, id));
  });

  app.get('/children/:id/balance', async (request) => {
    const actor = requestActor(request);
    const { id } = parseRequest(
      childParamsSchema,
      request.params,
      requestPath('path'),
    );
    const balance = await ledgerService.getBalance(actor, id);
    return LedgerBalanceSchema.parse({
      householdId: actor.householdId,
      childId: id,
      balanceCents: balance.balanceCents,
    });
  });

  app.post('/children/:id/ledger', async (request, reply) => {
    const actor = requestActor(request);
    const { id } = parseRequest(
      childParamsSchema,
      request.params,
      requestPath('path'),
    );
    const input = parseRequest(
      ManualLedgerEntrySchema,
      {
        ...bodyRecord(request.body),
        childId: id,
        idempotencyKey: request.headers['idempotency-key'],
      },
      ledgerCommandPath,
    );
    assertHousehold(actor, input.householdId);
    const transaction = await ledgerService.recordManualEntry(actor, input);
    return reply.code(201).send(LedgerTransactionSchema.parse(transaction));
  });
};

function ledgerCommandPath(path: PropertyKey[]): string {
  const [first, ...rest] = path.map(String);
  if (first === 'idempotencyKey') {
    return 'headers.idempotency-key';
  }
  if (first === 'childId') {
    return 'path.id';
  }
  return ['body', first, ...rest].filter(Boolean).join('.');
}
