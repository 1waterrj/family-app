import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  ChoreDecisionResultSchema,
  ChoreInstanceSchema,
  ChoreSubmissionResultSchema,
  ChoreTemplateSchema,
  LedgerSummarySchema,
} from '@family/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  issueDevelopmentActorToken,
  type ActorContext,
} from '../src/auth/actor-context.js';
import { createFixtures, type Fixtures } from './support/fixtures.js';
import { startTestDatabase, type TestDatabase } from './support/database.js';

const developmentAuthSecret =
  'test-only-e2e-development-secret-with-at-least-32-characters';

describe('family chore HTTP end to end', () => {
  let testDatabase: TestDatabase | undefined;
  let fixtures: Fixtures;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDatabase = await startTestDatabase({ maxConnections: 8 });
    fixtures = createFixtures(testDatabase.database);
    app = buildApp({
      database: testDatabase.database,
      nodeEnv: 'test',
      developmentAuthSecret,
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase?.stop();
  });

  it('pays Avery exactly once when an approval request is retried', async () => {
    const {
      child: primaryChild,
      dashboard,
      household,
      parent,
    } = await fixtures.household({ childName: 'Avery' });
    const secondaryChild = await fixtures.child(household.id, {
      name: 'Riley',
      color: 'green',
    });

    const templateResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-templates',
      headers: mutationHeaders(parent),
      payload: {
        householdId: household.id,
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        instructions: 'Put every toy in its bin.',
        defaultValueCents: 250,
        defaultDurationMinutes: 15,
      },
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = ChoreTemplateSchema.parse(templateResponse.json());

    const publishResponse = await app.inject({
      method: 'POST',
      url: '/v1/chore-instances',
      headers: mutationHeaders(parent),
      payload: {
        householdId: household.id,
        choreTemplateId: template.id,
      },
    });
    expect(publishResponse.statusCode).toBe(201);
    const published = ChoreInstanceSchema.parse(publishResponse.json());

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/chore-instances?status=AVAILABLE',
      headers: actorHeaders(dashboard),
    });
    expect(listResponse.statusCode).toBe(200);
    const available = ChoreInstanceSchema.array().parse(listResponse.json());
    expect(available.map(({ id }) => id)).toContain(published.id);

    const primaryChildClaim = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${published.id}/claim`,
      headers: mutationHeaders(dashboard),
      payload: { childId: primaryChild.id },
    });
    expect(primaryChildClaim.statusCode).toBe(200);
    expect(ChoreInstanceSchema.parse(primaryChildClaim.json())).toMatchObject({
      claimedChildId: primaryChild.id,
      status: 'CLAIMED',
    });

    const lostClaim = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${published.id}/claim`,
      headers: mutationHeaders(dashboard),
      payload: { childId: secondaryChild.id },
    });
    expect(lostClaim.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(lostClaim.json())).toMatchObject({
      code: 'CHORE_UNAVAILABLE',
    });

    const submission = await app.inject({
      method: 'POST',
      url: `/v1/chore-instances/${published.id}/submit`,
      headers: mutationHeaders(dashboard),
      payload: { childId: primaryChild.id },
    });
    expect(submission.statusCode).toBe(200);
    const submitted = ChoreSubmissionResultSchema.parse(submission.json());
    expect(submitted).toMatchObject({
      claimedChildId: primaryChild.id,
      status: 'AWAITING_APPROVAL',
    });

    const approvalKey = randomUUID();
    const approve = () =>
      app.inject({
        method: 'POST',
        url: `/v1/chore-instances/${published.id}/approve`,
        headers: mutationHeaders(parent, approvalKey),
        payload: {
          submissionAttemptId: submitted.submissionAttemptId,
          payoutCents: 300,
          note: 'Great job!',
        },
      });
    const firstApproval = await approve();
    const retriedApproval = await approve();
    expect(firstApproval.statusCode).toBe(200);
    expect(retriedApproval.statusCode).toBe(200);
    const firstDecision = ChoreDecisionResultSchema.parse(firstApproval.json());
    const retriedDecision = ChoreDecisionResultSchema.parse(
      retriedApproval.json(),
    );
    expect(retriedDecision.decisionId).toBe(firstDecision.decisionId);
    expect(retriedDecision.submissionAttemptId).toBe(
      submitted.submissionAttemptId,
    );
    expect(retriedDecision.decision).toBe('APPROVED');
    expect(retriedDecision.choreInstance).toEqual(firstDecision.choreInstance);

    const ledgerResponse = await app.inject({
      method: 'GET',
      url: `/v1/children/${primaryChild.id}/ledger`,
      headers: actorHeaders(parent),
    });
    expect(ledgerResponse.statusCode).toBe(200);
    const ledger = LedgerSummarySchema.parse(ledgerResponse.json());
    expect(ledger.balanceCents).toBe(300);
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({
      amountCents: 300,
      childId: primaryChild.id,
      note: 'Great job!',
      relatedChoreInstanceId: published.id,
      type: 'CHORE_CREDIT',
    });

    const [persistence] = await testDatabase!.sql<
      { decisionCount: number; creditCount: number }[]
    >`
      SELECT
        (
          SELECT count(*)::int
          FROM approval_decisions
          WHERE chore_instance_id = ${published.id}
        ) AS "decisionCount",
        (
          SELECT count(*)::int
          FROM ledger_transactions
          WHERE related_chore_instance_id = ${published.id}
            AND type = 'CHORE_CREDIT'
        ) AS "creditCount"
    `;
    expect(persistence).toEqual({ decisionCount: 1, creditCount: 1 });
  });
});

function actorHeaders(actor: ActorContext) {
  return {
    authorization: `Bearer ${issueDevelopmentActorToken(actor, developmentAuthSecret)}`,
  };
}

function mutationHeaders(actor: ActorContext, idempotencyKey = randomUUID()) {
  return {
    ...actorHeaders(actor),
    'idempotency-key': idempotencyKey,
  };
}
