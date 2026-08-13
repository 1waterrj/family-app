import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';

import {
  approvalDecisions,
  childProfiles,
  choreInstances,
  choreSubmissionAttempts,
  choreTemplates,
  choreTransitions,
  dashboardDevices,
  households,
  ledgerTransactions,
  parentMemberships,
} from '../db/schema.js';
import type { DatabaseTransaction } from '../db/transaction.js';

export class SnapshotRepository {
  async findHousehold(transaction: DatabaseTransaction, householdId: string) {
    const [household] = await transaction
      .select()
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    return household;
  }

  async findParentMembership(
    transaction: DatabaseTransaction,
    householdId: string,
    parentId: string,
  ) {
    const [membership] = await transaction
      .select()
      .from(parentMemberships)
      .where(
        and(
          eq(parentMemberships.householdId, householdId),
          eq(parentMemberships.parentId, parentId),
        ),
      )
      .limit(1);

    return membership;
  }

  async findDashboardDevice(
    transaction: DatabaseTransaction,
    householdId: string,
    dashboardId: string,
  ) {
    const [device] = await transaction
      .select()
      .from(dashboardDevices)
      .where(
        and(
          eq(dashboardDevices.householdId, householdId),
          eq(dashboardDevices.id, dashboardId),
        ),
      )
      .limit(1);

    return device;
  }

  async listChildrenWithBalances(
    transaction: DatabaseTransaction,
    householdId: string,
  ) {
    return transaction
      .select({
        profile: {
          id: childProfiles.id,
          householdId: childProfiles.householdId,
          name: childProfiles.name,
          color: childProfiles.color,
          imageUrl: childProfiles.imageUrl,
          createdAt: childProfiles.createdAt,
        },
        balanceCents: sql<string>`coalesce(sum(${ledgerTransactions.amountCents}), 0)::bigint`,
      })
      .from(childProfiles)
      .leftJoin(
        ledgerTransactions,
        and(
          eq(ledgerTransactions.householdId, childProfiles.householdId),
          eq(ledgerTransactions.childId, childProfiles.id),
        ),
      )
      .where(eq(childProfiles.householdId, householdId))
      .groupBy(
        childProfiles.id,
        childProfiles.householdId,
        childProfiles.name,
        childProfiles.color,
        childProfiles.imageUrl,
        childProfiles.createdAt,
      )
      .orderBy(asc(childProfiles.createdAt), asc(childProfiles.id));
  }

  async listActiveTemplates(
    transaction: DatabaseTransaction,
    householdId: string,
  ) {
    return transaction
      .select()
      .from(choreTemplates)
      .where(
        and(
          eq(choreTemplates.householdId, householdId),
          eq(choreTemplates.isActive, true),
        ),
      )
      .orderBy(asc(choreTemplates.createdAt), asc(choreTemplates.id));
  }

  async listOpenChores(transaction: DatabaseTransaction, householdId: string) {
    return transaction
      .select()
      .from(choreInstances)
      .where(
        and(
          eq(choreInstances.householdId, householdId),
          inArray(choreInstances.status, [
            'AVAILABLE',
            'CLAIMED',
            'AWAITING_APPROVAL',
          ]),
        ),
      )
      .orderBy(asc(choreInstances.createdAt), asc(choreInstances.id));
  }

  async listPendingApprovals(
    transaction: DatabaseTransaction,
    householdId: string,
  ) {
    const currentAttempts = transaction
      .select({
        householdId: choreSubmissionAttempts.householdId,
        choreInstanceId: choreSubmissionAttempts.choreInstanceId,
        attemptNumber: max(choreSubmissionAttempts.attemptNumber).as(
          'current_attempt_number',
        ),
      })
      .from(choreSubmissionAttempts)
      .where(eq(choreSubmissionAttempts.householdId, householdId))
      .groupBy(
        choreSubmissionAttempts.householdId,
        choreSubmissionAttempts.choreInstanceId,
      )
      .as('current_submission_attempts');

    return transaction
      .select({
        submissionAttemptId: choreSubmissionAttempts.id,
        submittedAt: choreSubmissionAttempts.submittedAt,
        claimedAt: sql<Date | null>`(
          SELECT max(${choreTransitions.createdAt})
          FROM ${choreTransitions}
          WHERE ${choreTransitions.householdId} = ${choreSubmissionAttempts.householdId}
            AND ${choreTransitions.choreInstanceId} = ${choreSubmissionAttempts.choreInstanceId}
            AND ${choreTransitions.toStatus} = 'CLAIMED'
            AND ${choreTransitions.createdAt} <= ${choreSubmissionAttempts.submittedAt}
        )`.mapWith(choreTransitions.createdAt),
        child: {
          id: childProfiles.id,
          householdId: childProfiles.householdId,
          name: childProfiles.name,
          color: childProfiles.color,
          imageUrl: childProfiles.imageUrl,
          createdAt: childProfiles.createdAt,
        },
        chore: {
          id: choreInstances.id,
          householdId: choreInstances.householdId,
          choreTemplateId: choreInstances.choreTemplateId,
          name: choreInstances.name,
          imageKey: choreInstances.imageKey,
          imageUrl: choreInstances.imageUrl,
          instructions: choreInstances.instructions,
          valueCents: choreInstances.valueCents,
          durationSeconds: choreInstances.durationSeconds,
          status: choreInstances.status,
          claimedByChildId: choreInstances.claimedByChildId,
          claimDeadlineAt: choreInstances.claimDeadlineAt,
          submittedAt: choreInstances.submittedAt,
          createdAt: choreInstances.createdAt,
        },
      })
      .from(choreSubmissionAttempts)
      .innerJoin(
        currentAttempts,
        and(
          eq(currentAttempts.householdId, choreSubmissionAttempts.householdId),
          eq(
            currentAttempts.choreInstanceId,
            choreSubmissionAttempts.choreInstanceId,
          ),
          eq(
            currentAttempts.attemptNumber,
            choreSubmissionAttempts.attemptNumber,
          ),
        ),
      )
      .innerJoin(
        childProfiles,
        and(
          eq(childProfiles.householdId, choreSubmissionAttempts.householdId),
          eq(childProfiles.id, choreSubmissionAttempts.claimedByChildId),
        ),
      )
      .innerJoin(
        choreInstances,
        and(
          eq(choreInstances.householdId, choreSubmissionAttempts.householdId),
          eq(choreInstances.id, choreSubmissionAttempts.choreInstanceId),
        ),
      )
      .leftJoin(
        approvalDecisions,
        and(
          eq(
            approvalDecisions.householdId,
            choreSubmissionAttempts.householdId,
          ),
          eq(approvalDecisions.submissionAttemptId, choreSubmissionAttempts.id),
        ),
      )
      .where(
        and(
          eq(choreSubmissionAttempts.householdId, householdId),
          eq(choreInstances.status, 'AWAITING_APPROVAL'),
          isNull(approvalDecisions.id),
        ),
      )
      .orderBy(
        asc(choreSubmissionAttempts.submittedAt),
        asc(choreSubmissionAttempts.id),
      );
  }
}
