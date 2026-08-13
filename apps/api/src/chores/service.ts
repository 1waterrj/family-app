import type {
  ApproveChore,
  CancelChoreClaim,
  ClaimChore,
  CreateChoreTemplate,
  ExtendChoreClaim,
  PublishChoreInstance,
  RejectChore,
  SubmitChore,
} from '@family/contracts';
import {
  ChoreDecisionResultSchema,
  ChoreInstanceSchema,
  ChoreSubmissionResultSchema,
  ChoreTemplateSchema,
} from '@family/contracts';

import {
  ActorContextError,
  assertHousehold,
  type ActorContext,
  requireDashboard,
  requireParent,
} from '../auth/actor-context.js';
import { DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS } from '../config.js';
import type { Database } from '../db/client.js';
import type { DatabaseTransaction } from '../db/transaction.js';
import { IdempotentCommandExecutor } from '../idempotency/executor.js';
import { LedgerRepository } from '../ledger/repository.js';
import { ChoreRepository } from './repository.js';

const millisecondsPerMinute = 60_000;
const secondsPerMinute = 60;
const ChoreDecisionOperationResultSchema = ChoreInstanceSchema.extend(
  ChoreDecisionResultSchema.omit({ choreInstance: true }).shape,
);

export interface Clock {
  now(): Date;
}

export class ChoreServiceError extends Error {
  constructor(
    readonly code:
      'CHORE_UNAVAILABLE' | 'CONFLICT' | 'INVALID_STATE' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ChoreServiceError';
  }
}

export class ChoreService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly repository = new ChoreRepository(),
    private readonly ledgerRepository = new LedgerRepository(),
    private readonly householdPayoutCeilingCents = DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS,
    private readonly idempotency = new IdempotentCommandExecutor(
      database,
      undefined,
      () => clock.now(),
    ),
  ) {
    if (
      !Number.isSafeInteger(householdPayoutCeilingCents) ||
      householdPayoutCeilingCents < 0 ||
      householdPayoutCeilingCents > DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS
    ) {
      throw validationError('The household payout ceiling is invalid.');
    }
  }

  async createTemplate(actor: ActorContext, input: CreateChoreTemplate) {
    const parent = requireParent(actor);
    assertHousehold(parent, input.householdId);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'CREATE_CHORE_TEMPLATE',
      request: input,
      responseSchema: ChoreTemplateSchema,
      work: async (transaction) =>
        toChoreTemplate(
          await this.repository.createTemplate(
            transaction,
            parent.householdId,
            {
              createdByParentId: parent.actorId,
              name: input.name,
              imageKey: input.imageKey,
              imageUrl: input.imageUrl,
              instructions: input.instructions,
              defaultValueCents: input.defaultValueCents,
              defaultDurationSeconds:
                input.defaultDurationMinutes * secondsPerMinute,
            },
          ),
        ),
    });
  }

  async publish(actor: ActorContext, input: PublishChoreInstance) {
    const parent = requireParent(actor);
    assertHousehold(parent, input.householdId);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'PUBLISH_CHORE_INSTANCE',
      request: input,
      responseSchema: ChoreInstanceSchema,
      work: async (transaction) => {
        const template = await this.repository.findTemplate(
          transaction,
          parent.householdId,
          input.choreTemplateId,
        );
        if (!template) {
          throw notFound();
        }
        if (!template.isActive) {
          throw new ChoreServiceError(
            'INVALID_STATE',
            'The chore template is inactive.',
          );
        }

        return toChoreInstance(
          await this.repository.createInstance(
            transaction,
            parent.householdId,
            {
              choreTemplateId: template.id,
              name: template.name,
              imageKey: template.imageKey,
              imageUrl: template.imageUrl,
              instructions: input.instructions ?? template.instructions,
              valueCents: input.valueCents ?? template.defaultValueCents,
              durationSeconds:
                input.durationMinutes === undefined
                  ? template.defaultDurationSeconds
                  : input.durationMinutes * secondsPerMinute,
            },
          ),
        );
      },
    });
  }

  async listAvailable(actor: ActorContext) {
    const instances = await this.database.transaction((transaction) =>
      this.repository.listAvailable(transaction, actor.householdId),
    );

    return instances.map(toChoreInstance);
  }

  async claim(actor: ActorContext, input: ClaimChore) {
    const dashboard = requireDashboard(actor);

    return this.idempotency.execute({
      actor: dashboard,
      idempotencyKey: input.idempotencyKey,
      operation: 'CLAIM_CHORE',
      request: input,
      responseSchema: ChoreInstanceSchema,
      work: async (transaction) => {
        const child = await this.repository.findChild(
          transaction,
          dashboard.householdId,
          input.childId,
        );
        if (!child) {
          throw notFound();
        }

        const current = await this.repository.findInstanceForUpdate(
          transaction,
          dashboard.householdId,
          input.choreInstanceId,
        );
        if (!current) {
          throw notFound();
        }
        if (current.status !== 'AVAILABLE') {
          throw unavailable();
        }

        const now = this.clock.now();
        const deadlineAt = new Date(
          now.getTime() + current.durationSeconds * 1_000,
        );
        const instance = await this.repository.claim(
          transaction,
          dashboard.householdId,
          current.id,
          child.id,
          deadlineAt,
        );
        if (!instance) {
          throw unavailable();
        }

        await this.repository.insertTransition(
          transaction,
          dashboard.householdId,
          {
            choreInstanceId: instance.id,
            fromStatus: 'AVAILABLE',
            toStatus: 'CLAIMED',
            actor: dashboard,
          },
        );

        return toChoreInstance(instance);
      },
    });
  }

  async submit(actor: ActorContext, input: SubmitChore) {
    const dashboard = requireDashboard(actor);

    return this.idempotency.execute({
      actor: dashboard,
      idempotencyKey: input.idempotencyKey,
      operation: 'SUBMIT_CHORE',
      request: input,
      responseSchema: ChoreSubmissionResultSchema,
      work: async (transaction) => {
        const child = await this.repository.findChild(
          transaction,
          dashboard.householdId,
          input.childId,
        );
        if (!child) {
          throw notFound();
        }

        const current = await this.repository.findInstanceForUpdate(
          transaction,
          dashboard.householdId,
          input.choreInstanceId,
        );
        if (!current) {
          throw notFound();
        }
        const now = this.clock.now();
        if (
          current.status !== 'CLAIMED' ||
          current.claimedByChildId !== child.id ||
          current.claimDeadlineAt === null ||
          now.getTime() >= current.claimDeadlineAt.getTime()
        ) {
          throw invalidState('The chore cannot be submitted.');
        }

        const instance = await this.repository.submit(
          transaction,
          dashboard.householdId,
          current.id,
          now,
        );
        if (!instance) {
          throw invalidState('The chore cannot be submitted.');
        }

        const submissionAttempt = await this.repository.createSubmissionAttempt(
          transaction,
          dashboard.householdId,
          {
            choreInstanceId: instance.id,
            claimedByChildId: child.id,
            submittedAt: now,
          },
        );

        await this.repository.insertTransition(
          transaction,
          dashboard.householdId,
          {
            choreInstanceId: instance.id,
            fromStatus: 'CLAIMED',
            toStatus: 'AWAITING_APPROVAL',
            actor: dashboard,
          },
        );

        return ChoreSubmissionResultSchema.parse({
          ...toChoreInstance(instance),
          submissionAttemptId: submissionAttempt!.id,
        });
      },
    });
  }

  async extend(actor: ActorContext, input: ExtendChoreClaim) {
    const parent = requireParent(actor);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'EXTEND_CHORE_CLAIM',
      request: input,
      responseSchema: ChoreInstanceSchema,
      work: async (transaction) => {
        const current = await this.repository.findInstanceForUpdate(
          transaction,
          parent.householdId,
          input.choreInstanceId,
        );
        if (!current) {
          throw notFound();
        }
        const now = this.clock.now();
        if (
          current.status !== 'CLAIMED' ||
          current.claimDeadlineAt === null ||
          now.getTime() >= current.claimDeadlineAt.getTime()
        ) {
          throw invalidState('Only an active claim can be extended.');
        }

        const deadlineAt = new Date(
          current.claimDeadlineAt.getTime() +
            input.additionalMinutes * millisecondsPerMinute,
        );
        const instance = await this.repository.extend(
          transaction,
          parent.householdId,
          current.id,
          deadlineAt,
        );
        if (!instance) {
          throw invalidState('Only an active claim can be extended.');
        }

        await this.repository.insertTransition(
          transaction,
          parent.householdId,
          {
            choreInstanceId: instance.id,
            fromStatus: 'CLAIMED',
            toStatus: 'CLAIMED',
            actor: parent,
            reason: input.reason,
          },
        );

        return toChoreInstance(instance);
      },
    });
  }

  async cancel(actor: ActorContext, input: CancelChoreClaim) {
    const parent = requireParent(actor);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'CANCEL_CHORE_CLAIM',
      request: input,
      responseSchema: ChoreInstanceSchema,
      work: async (transaction) => {
        const current = await this.repository.findInstanceForUpdate(
          transaction,
          parent.householdId,
          input.choreInstanceId,
        );
        if (!current) {
          throw notFound();
        }
        const now = this.clock.now();
        if (
          current.status !== 'CLAIMED' ||
          current.claimDeadlineAt === null ||
          now.getTime() >= current.claimDeadlineAt.getTime()
        ) {
          throw invalidState('Only an active claim can be cancelled.');
        }

        const instance = await this.repository.cancel(
          transaction,
          parent.householdId,
          current.id,
        );
        if (!instance) {
          throw invalidState('Only an active claim can be cancelled.');
        }

        await this.repository.insertTransition(
          transaction,
          parent.householdId,
          {
            choreInstanceId: instance.id,
            fromStatus: 'CLAIMED',
            toStatus: 'AVAILABLE',
            actor: parent,
            reason: input.reason,
          },
        );

        return toChoreInstance(instance);
      },
    });
  }

  async approve(actor: ActorContext, input: ApproveChore) {
    const parent = requireParent(actor);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'APPROVE_CHORE',
      request: input,
      responseSchema: ChoreDecisionOperationResultSchema,
      work: async (transaction) => {
        const target = await this.findDecisionTarget(
          transaction,
          parent,
          input,
        );
        if (target.decision) {
          return toChoreDecisionOperationResult(
            target.current,
            target.decision,
          );
        }
        this.assertCurrentDecisionTarget(target);

        const payoutCents = input.payoutCents ?? target.current.valueCents;
        this.validatePayout(payoutCents);
        const decidedAt = this.clock.now();
        const decision = await this.repository.insertDecision(
          transaction,
          parent.householdId,
          {
            choreInstanceId: target.current.id,
            submissionAttemptId: target.attempt.id,
            decidedByParentId: parent.actorId,
            decision: 'APPROVED',
            payoutCents,
            note: input.note ?? null,
            idempotencyKey: input.idempotencyKey,
            createdAt: decidedAt,
          },
        );
        if (!decision) {
          throw invalidState('The chore decision could not be recorded.');
        }
        await this.ledgerRepository.insertChoreCredit(
          transaction,
          parent.householdId,
          {
            childId: target.attempt.claimedByChildId!,
            amountCents: payoutCents,
            note: input.note ?? null,
            actorParentId: parent.actorId,
            relatedChoreInstanceId: target.current.id,
            approvalDecisionId: decision.id,
            createdAt: decidedAt,
          },
        );
        const approved = await this.repository.approve(
          transaction,
          parent.householdId,
          target.current.id,
        );
        if (!approved) {
          throw invalidState('The chore cannot be approved.');
        }

        await this.repository.insertTransition(
          transaction,
          parent.householdId,
          {
            choreInstanceId: target.current.id,
            fromStatus: 'AWAITING_APPROVAL',
            toStatus: 'APPROVED',
            actor: parent,
            reason: input.note,
            createdAt: decidedAt,
          },
        );
        await this.repository.insertAuditEvent(
          transaction,
          parent.householdId,
          {
            actor: parent,
            eventType: 'CHORE_APPROVED',
            entityType: 'CHORE_INSTANCE',
            entityId: target.current.id,
            payload: {
              childId: target.attempt.claimedByChildId,
              decision: 'APPROVED',
              payoutCents,
              submissionAttemptId: target.attempt.id,
            },
            createdAt: decidedAt,
          },
        );

        return toChoreDecisionOperationResult(approved, decision);
      },
    });
  }

  async reject(actor: ActorContext, input: RejectChore) {
    const parent = requireParent(actor);

    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: input.idempotencyKey,
      operation: 'REJECT_CHORE',
      request: input,
      responseSchema: ChoreDecisionOperationResultSchema,
      work: async (transaction) => {
        const target = await this.findDecisionTarget(
          transaction,
          parent,
          input,
        );
        if (target.decision) {
          return toChoreDecisionOperationResult(
            target.current,
            target.decision,
          );
        }
        this.assertCurrentDecisionTarget(target);

        const decidedAt = this.clock.now();
        const decision = await this.repository.insertDecision(
          transaction,
          parent.householdId,
          {
            choreInstanceId: target.current.id,
            submissionAttemptId: target.attempt.id,
            decidedByParentId: parent.actorId,
            decision: 'REJECTED',
            payoutCents: null,
            note: input.reason ?? null,
            idempotencyKey: input.idempotencyKey,
            createdAt: decidedAt,
          },
        );
        if (!decision) {
          throw invalidState('The chore decision could not be recorded.');
        }
        const rejected = await this.repository.reject(
          transaction,
          parent.householdId,
          target.current.id,
          input.retry,
        );
        if (!rejected) {
          throw invalidState('The chore cannot be rejected.');
        }

        const toStatus = input.retry ? 'AVAILABLE' : 'CLOSED';
        await this.repository.insertTransition(
          transaction,
          parent.householdId,
          {
            choreInstanceId: target.current.id,
            fromStatus: 'AWAITING_APPROVAL',
            toStatus,
            actor: parent,
            reason: input.reason,
            createdAt: decidedAt,
          },
        );
        await this.repository.insertAuditEvent(
          transaction,
          parent.householdId,
          {
            actor: parent,
            eventType: 'CHORE_REJECTED',
            entityType: 'CHORE_INSTANCE',
            entityId: target.current.id,
            payload: {
              decision: 'REJECTED',
              reason: input.reason ?? null,
              retry: input.retry,
              submissionAttemptId: target.attempt.id,
            },
            createdAt: decidedAt,
          },
        );

        return toChoreDecisionOperationResult(rejected, decision);
      },
    });
  }

  private async findDecisionTarget(
    transaction: DatabaseTransaction,
    parent: Extract<ActorContext, { role: 'PARENT' }>,
    input: ApproveChore | RejectChore,
  ) {
    const current = await this.repository.findInstanceForUpdate(
      transaction,
      parent.householdId,
      input.choreInstanceId,
    );
    if (!current) {
      throw notFound();
    }
    const attempt = await this.repository.findSubmissionAttempt(
      transaction,
      parent.householdId,
      current.id,
      input.submissionAttemptId,
    );
    if (!attempt) {
      throw notFound();
    }
    const decision = await this.repository.findDecisionByAttempt(
      transaction,
      parent.householdId,
      attempt.id,
    );
    const latestAttempt = decision
      ? undefined
      : await this.repository.findCurrentSubmissionAttempt(
          transaction,
          parent.householdId,
          current.id,
        );

    return { attempt, current, decision, latestAttempt };
  }

  private assertCurrentDecisionTarget(
    target: Awaited<ReturnType<ChoreService['findDecisionTarget']>>,
  ): void {
    if (
      target.current.status !== 'AWAITING_APPROVAL' ||
      target.latestAttempt?.id !== target.attempt.id
    ) {
      throw invalidState(
        'The requested submission attempt is not awaiting a decision.',
      );
    }
    if (target.attempt.claimedByChildId === null) {
      throw invalidState('The submission attempt has no claimant snapshot.');
    }
  }

  private validatePayout(payoutCents: number): void {
    if (
      !Number.isSafeInteger(payoutCents) ||
      payoutCents < 0 ||
      payoutCents > this.householdPayoutCeilingCents
    ) {
      throw validationError(
        `Payout must be an integer from 0 to ${this.householdPayoutCeilingCents} cents.`,
      );
    }
  }
}

function toChoreTemplate(
  template: typeof import('../db/schema.js').choreTemplates.$inferSelect,
) {
  return ChoreTemplateSchema.parse({
    id: template.id,
    householdId: template.householdId,
    name: template.name,
    imageKey: template.imageKey,
    imageUrl: template.imageUrl,
    instructions: template.instructions,
    defaultValueCents: template.defaultValueCents,
    defaultDurationMinutes: template.defaultDurationSeconds / 60,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
  });
}

function toChoreInstance(
  instance: typeof import('../db/schema.js').choreInstances.$inferSelect,
) {
  return ChoreInstanceSchema.parse({
    id: instance.id,
    householdId: instance.householdId,
    choreTemplateId: instance.choreTemplateId,
    name: instance.name,
    imageKey: instance.imageKey,
    imageUrl: instance.imageUrl,
    instructions: instance.instructions,
    valueCents: instance.valueCents,
    durationMinutes: instance.durationSeconds / 60,
    status: instance.status,
    claimedChildId: instance.claimedByChildId,
    claimDeadlineAt: instance.claimDeadlineAt?.toISOString() ?? null,
    submittedAt: instance.submittedAt?.toISOString() ?? null,
    createdAt: instance.createdAt.toISOString(),
  });
}

function toChoreDecisionOperationResult(
  instance: typeof import('../db/schema.js').choreInstances.$inferSelect,
  decision: typeof import('../db/schema.js').approvalDecisions.$inferSelect,
) {
  return ChoreDecisionOperationResultSchema.parse({
    ...toChoreInstance(instance),
    decisionId: decision.id,
    submissionAttemptId: decision.submissionAttemptId,
    decision: decision.decision,
    payoutCents: decision.payoutCents,
    note: decision.note,
  });
}

function notFound(): ActorContextError {
  return new ActorContextError('NOT_FOUND', 'Resource not found.');
}

function unavailable(): ChoreServiceError {
  return new ChoreServiceError(
    'CHORE_UNAVAILABLE',
    'The chore is no longer available.',
  );
}

function invalidState(message: string): ChoreServiceError {
  return new ChoreServiceError('INVALID_STATE', message);
}

function validationError(message: string): ChoreServiceError {
  return new ChoreServiceError('VALIDATION_ERROR', message);
}
