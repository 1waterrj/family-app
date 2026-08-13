import { and, asc, desc, eq } from 'drizzle-orm';

import type { ChoreImageKey } from '@family/contracts';

import type { ActorContext } from '../auth/actor-context.js';
import {
  approvalDecisions,
  auditEvents,
  childProfiles,
  choreInstances,
  choreSubmissionAttempts,
  choreTemplates,
  choreTransitions,
} from '../db/schema.js';
import type { DatabaseTransaction } from '../db/transaction.js';

export interface CreateTemplateRecord {
  createdByParentId: string;
  name: string;
  imageKey: ChoreImageKey;
  imageUrl?: string;
  instructions: string;
  defaultValueCents: number;
  defaultDurationSeconds: number;
}

export interface CreateInstanceRecord {
  choreTemplateId: string;
  name: string;
  imageKey: ChoreImageKey | null;
  imageUrl: string | null;
  instructions: string;
  valueCents: number;
  durationSeconds: number;
}

export interface TransitionRecord {
  choreInstanceId: string;
  fromStatus: typeof choreInstances.$inferSelect.status;
  toStatus: typeof choreInstances.$inferSelect.status;
  actor: ActorContext;
  reason?: string;
  createdAt?: Date;
}

export interface ApprovalDecisionRecord {
  choreInstanceId: string;
  submissionAttemptId: string;
  decidedByParentId: string;
  decision: 'APPROVED' | 'REJECTED';
  payoutCents: number | null;
  note: string | null;
  idempotencyKey: string;
  createdAt: Date;
}

export interface SubmissionAttemptRecord {
  choreInstanceId: string;
  claimedByChildId: string;
  submittedAt: Date;
}

export interface AuditEventRecord {
  actor: ActorContext;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export class ChoreRepository {
  async createTemplate(
    transaction: DatabaseTransaction,
    householdId: string,
    record: CreateTemplateRecord,
  ) {
    const [template] = await transaction
      .insert(choreTemplates)
      .values({ householdId, ...record })
      .returning();

    return template;
  }

  async findTemplate(
    transaction: DatabaseTransaction,
    householdId: string,
    templateId: string,
  ) {
    const [template] = await transaction
      .select()
      .from(choreTemplates)
      .where(
        and(
          eq(choreTemplates.householdId, householdId),
          eq(choreTemplates.id, templateId),
        ),
      )
      .limit(1);

    return template;
  }

  async createInstance(
    transaction: DatabaseTransaction,
    householdId: string,
    record: CreateInstanceRecord,
  ) {
    const [instance] = await transaction
      .insert(choreInstances)
      .values({ householdId, ...record })
      .returning();

    return instance;
  }

  async listAvailable(transaction: DatabaseTransaction, householdId: string) {
    return transaction
      .select()
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.status, 'AVAILABLE'),
        ),
      )
      .orderBy(asc(choreInstances.createdAt), asc(choreInstances.id));
  }

  async findChild(
    transaction: DatabaseTransaction,
    householdId: string,
    childId: string,
  ) {
    const [child] = await transaction
      .select()
      .from(childProfiles)
      .where(
        and(
          eq(childProfiles.householdId, householdId),
          eq(childProfiles.id, childId),
        ),
      )
      .limit(1);

    return child;
  }

  async findInstance(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
  ) {
    const [instance] = await transaction
      .select()
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
        ),
      )
      .limit(1);

    return instance;
  }

  async findInstanceForUpdate(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
  ) {
    const [instance] = await transaction
      .select()
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
        ),
      )
      .for('update')
      .limit(1);

    return instance;
  }

  async createSubmissionAttempt(
    transaction: DatabaseTransaction,
    householdId: string,
    record: SubmissionAttemptRecord,
  ) {
    const [latest] = await transaction
      .select({ attemptNumber: choreSubmissionAttempts.attemptNumber })
      .from(choreSubmissionAttempts)
      .where(
        and(
          eq(choreSubmissionAttempts.householdId, householdId),
          eq(choreSubmissionAttempts.choreInstanceId, record.choreInstanceId),
        ),
      )
      .orderBy(desc(choreSubmissionAttempts.attemptNumber))
      .limit(1);

    const [attempt] = await transaction
      .insert(choreSubmissionAttempts)
      .values({
        householdId,
        choreInstanceId: record.choreInstanceId,
        claimedByChildId: record.claimedByChildId,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        submittedAt: record.submittedAt,
        createdAt: record.submittedAt,
      })
      .returning();

    return attempt;
  }

  async findCurrentSubmissionAttempt(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
  ) {
    const [attempt] = await transaction
      .select()
      .from(choreSubmissionAttempts)
      .where(
        and(
          eq(choreSubmissionAttempts.householdId, householdId),
          eq(choreSubmissionAttempts.choreInstanceId, choreInstanceId),
        ),
      )
      .orderBy(desc(choreSubmissionAttempts.attemptNumber))
      .limit(1);

    return attempt;
  }

  async findSubmissionAttempt(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
    submissionAttemptId: string,
  ) {
    const [attempt] = await transaction
      .select()
      .from(choreSubmissionAttempts)
      .where(
        and(
          eq(choreSubmissionAttempts.householdId, householdId),
          eq(choreSubmissionAttempts.choreInstanceId, choreInstanceId),
          eq(choreSubmissionAttempts.id, submissionAttemptId),
        ),
      )
      .limit(1);

    return attempt;
  }

  async findDecisionByAttempt(
    transaction: DatabaseTransaction,
    householdId: string,
    submissionAttemptId: string,
  ) {
    const [decision] = await transaction
      .select()
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.householdId, householdId),
          eq(approvalDecisions.submissionAttemptId, submissionAttemptId),
        ),
      )
      .limit(1);

    return decision;
  }

  async insertDecision(
    transaction: DatabaseTransaction,
    householdId: string,
    record: ApprovalDecisionRecord,
  ) {
    const [decision] = await transaction
      .insert(approvalDecisions)
      .values({ householdId, ...record })
      .returning();

    return decision;
  }

  async claim(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
    childId: string,
    deadlineAt: Date,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set({
        status: 'CLAIMED',
        claimedByChildId: childId,
        claimDeadlineAt: deadlineAt,
      })
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'AVAILABLE'),
        ),
      )
      .returning();

    return instance;
  }

  async submit(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
    submittedAt: Date,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set({ status: 'AWAITING_APPROVAL', submittedAt })
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'CLAIMED'),
        ),
      )
      .returning();

    return instance;
  }

  async extend(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
    deadlineAt: Date,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set({ claimDeadlineAt: deadlineAt })
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'CLAIMED'),
        ),
      )
      .returning();

    return instance;
  }

  async cancel(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set({
        status: 'AVAILABLE',
        claimedByChildId: null,
        claimDeadlineAt: null,
        submittedAt: null,
      })
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'CLAIMED'),
        ),
      )
      .returning();

    return instance;
  }

  async approve(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set({ status: 'APPROVED' })
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'AWAITING_APPROVAL'),
        ),
      )
      .returning();

    return instance;
  }

  async reject(
    transaction: DatabaseTransaction,
    householdId: string,
    choreInstanceId: string,
    retry: boolean,
  ) {
    const [instance] = await transaction
      .update(choreInstances)
      .set(
        retry
          ? {
              status: 'AVAILABLE',
              claimedByChildId: null,
              claimDeadlineAt: null,
              submittedAt: null,
            }
          : { status: 'CLOSED' },
      )
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          eq(choreInstances.id, choreInstanceId),
          eq(choreInstances.status, 'AWAITING_APPROVAL'),
        ),
      )
      .returning();

    return instance;
  }

  async insertTransition(
    transaction: DatabaseTransaction,
    householdId: string,
    record: TransitionRecord,
  ): Promise<void> {
    await transaction.insert(choreTransitions).values({
      householdId,
      choreInstanceId: record.choreInstanceId,
      fromStatus: record.fromStatus,
      toStatus: record.toStatus,
      actorRole: record.actor.role,
      actorParentId:
        record.actor.role === 'PARENT' ? record.actor.actorId : null,
      actorDashboardDeviceId:
        record.actor.role === 'DASHBOARD' ? record.actor.actorId : null,
      reason: record.reason,
      createdAt: record.createdAt,
    });
  }

  async insertAuditEvent(
    transaction: DatabaseTransaction,
    householdId: string,
    record: AuditEventRecord,
  ): Promise<void> {
    await transaction.insert(auditEvents).values({
      householdId,
      actorRole: record.actor.role,
      actorParentId:
        record.actor.role === 'PARENT' ? record.actor.actorId : null,
      actorDashboardDeviceId:
        record.actor.role === 'DASHBOARD' ? record.actor.actorId : null,
      eventType: record.eventType,
      entityType: record.entityType,
      entityId: record.entityId,
      payload: record.payload,
      createdAt: record.createdAt,
    });
  }
}
