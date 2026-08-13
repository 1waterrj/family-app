import {
  ClientDiagnosticSnapshotSchema,
  CreateFeedbackCommandSchema,
  MAX_FEEDBACK_TITLE_LENGTH,
  type ClientDiagnosticSnapshot,
  type CreateFeedbackCommand,
  type FeedbackStatus,
} from '@family/contracts';
import { and, asc, count, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { ActorContext } from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import {
  auditEvents,
  childProfiles,
  dashboardDevices,
  feedbackReports,
  households,
  idempotencyRecords,
  parentMemberships,
} from '../db/schema.js';
import type { DatabaseTransaction } from '../db/transaction.js';

const StoredFeedbackTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEEDBACK_TITLE_LENGTH);

export type FeedbackRow = Omit<
  typeof feedbackReports.$inferSelect,
  'diagnosticSnapshot'
> & {
  diagnosticSnapshot: ClientDiagnosticSnapshot;
};

export interface FeedbackUpdatePatch {
  title?: string;
  description?: string;
  diagnosticSnapshot?: ClientDiagnosticSnapshot;
  status?: FeedbackStatus;
  reviewedByParentId?: string;
  reviewedAt?: Date;
  publicIssueUrl?: string | null;
  exportedAt?: Date | null;
  closedAt?: Date | null;
  updatedAt: Date;
}

export class FeedbackRepository {
  async findSubmittingActor(
    transaction: DatabaseTransaction,
    actor: ActorContext,
  ): Promise<unknown | undefined> {
    if (actor.role === 'PARENT') {
      const [membership] = await transaction
        .select({ id: parentMemberships.id })
        .from(parentMemberships)
        .where(
          and(
            eq(parentMemberships.householdId, actor.householdId),
            eq(parentMemberships.parentId, actor.actorId),
          ),
        )
        .limit(1);
      return membership;
    }

    const [device] = await transaction
      .select({ id: dashboardDevices.id })
      .from(dashboardDevices)
      .where(
        and(
          eq(dashboardDevices.householdId, actor.householdId),
          eq(dashboardDevices.id, actor.actorId),
        ),
      )
      .for('update')
      .limit(1);
    return device;
  }

  async insert(
    transaction: DatabaseTransaction,
    actor: ActorContext,
    command: CreateFeedbackCommand,
    now: Date,
    title: string,
  ): Promise<FeedbackRow> {
    const validatedCommand = CreateFeedbackCommandSchema.parse(command);
    const validatedTitle = StoredFeedbackTitleSchema.parse(title);
    const snapshot = validatedCommand.diagnosticSnapshot;
    const [report] = await transaction
      .insert(feedbackReports)
      .values({
        householdId: actor.householdId,
        submittedByRole: actor.role,
        submittedByParentId: actor.role === 'PARENT' ? actor.actorId : null,
        submittedByDashboardDeviceId:
          actor.role === 'DASHBOARD' ? actor.actorId : null,
        category: validatedCommand.category,
        title: validatedTitle,
        description: validatedCommand.description,
        source: snapshot.source,
        appVersion: snapshot.appVersion,
        screen: snapshot.currentScreen,
        diagnosticSnapshot: snapshot,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!report) {
      throw new Error('Feedback insert returned no report.');
    }
    return toFeedbackRow(report);
  }

  async listByHousehold(
    database: Database | DatabaseTransaction,
    householdId: string,
  ): Promise<FeedbackRow[]> {
    const reports = await database
      .select()
      .from(feedbackReports)
      .where(eq(feedbackReports.householdId, householdId))
      .orderBy(desc(feedbackReports.createdAt), desc(feedbackReports.id));
    return reports.map(toFeedbackRow);
  }

  async findByHousehold(
    databaseOrTransaction: Database | DatabaseTransaction,
    householdId: string,
    feedbackId: string,
  ): Promise<FeedbackRow | undefined> {
    const [report] = await databaseOrTransaction
      .select()
      .from(feedbackReports)
      .where(
        and(
          eq(feedbackReports.householdId, householdId),
          eq(feedbackReports.id, feedbackId),
        ),
      )
      .limit(1);
    return report ? toFeedbackRow(report) : undefined;
  }

  async listKnownPrivateTerms(
    databaseOrTransaction: Database | DatabaseTransaction,
    householdId: string,
  ): Promise<string[]> {
    const [householdRows, children, devices] = await Promise.all([
      databaseOrTransaction
        .select({ name: households.name })
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1),
      databaseOrTransaction
        .select({ name: childProfiles.name })
        .from(childProfiles)
        .where(eq(childProfiles.householdId, householdId))
        .orderBy(asc(childProfiles.id)),
      databaseOrTransaction
        .select({ name: dashboardDevices.name })
        .from(dashboardDevices)
        .where(eq(dashboardDevices.householdId, householdId))
        .orderBy(asc(dashboardDevices.id)),
    ]);
    return [
      ...householdRows.map(({ name }) => name),
      ...children.map(({ name }) => name),
      ...devices.map(({ name }) => name),
    ];
  }

  async update(
    transaction: DatabaseTransaction,
    householdId: string,
    feedbackId: string,
    expectedUpdatedAt: Date,
    patch: FeedbackUpdatePatch,
  ): Promise<FeedbackRow | undefined> {
    const [report] = await transaction
      .update(feedbackReports)
      .set(patch)
      .where(
        and(
          eq(feedbackReports.householdId, householdId),
          eq(feedbackReports.id, feedbackId),
          eq(feedbackReports.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning();
    return report ? toFeedbackRow(report) : undefined;
  }

  async delete(
    transaction: DatabaseTransaction,
    householdId: string,
    feedbackId: string,
  ): Promise<FeedbackRow | undefined> {
    await this.deleteUpdateReplaysForReports(transaction, [
      { householdId, reportId: feedbackId },
    ]);
    const [report] = await transaction
      .delete(feedbackReports)
      .where(
        and(
          eq(feedbackReports.householdId, householdId),
          eq(feedbackReports.id, feedbackId),
        ),
      )
      .returning();
    return report ? toFeedbackRow(report) : undefined;
  }

  async deleteUpdateReplaysForReports(
    transaction: DatabaseTransaction,
    links: readonly { householdId: string; reportId: string }[],
  ): Promise<void> {
    if (links.length === 0) return;
    const reportIdsByHousehold = new Map<string, string[]>();
    for (const { householdId, reportId } of links) {
      const reportIds = reportIdsByHousehold.get(householdId) ?? [];
      reportIds.push(reportId);
      reportIdsByHousehold.set(householdId, reportIds);
    }
    const exactReportLinks = or(
      ...[...reportIdsByHousehold].map(([householdId, reportIds]) =>
        and(
          eq(idempotencyRecords.householdId, householdId),
          inArray(
            sql<string>`${idempotencyRecords.response} ->> 'id'`,
            reportIds,
          ),
        ),
      ),
    );
    await transaction
      .delete(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.operation, 'UPDATE_FEEDBACK'),
          exactReportLinks,
        ),
      );
  }

  async countDashboardSubmissionsSince(
    transaction: DatabaseTransaction,
    householdId: string,
    dashboardId: string,
    since: Date,
  ): Promise<number> {
    const [result] = await transaction
      .select({ value: count() })
      .from(feedbackReports)
      .where(
        and(
          eq(feedbackReports.householdId, householdId),
          eq(feedbackReports.submittedByDashboardDeviceId, dashboardId),
          gte(feedbackReports.createdAt, since),
        ),
      );
    return result?.value ?? 0;
  }

  async insertAuditEvent(
    transaction: DatabaseTransaction,
    actor: ActorContext,
    feedbackId: string,
    eventType: string,
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await transaction.insert(auditEvents).values({
      householdId: actor.householdId,
      actorRole: actor.role,
      actorParentId: actor.role === 'PARENT' ? actor.actorId : null,
      actorDashboardDeviceId: actor.role === 'DASHBOARD' ? actor.actorId : null,
      eventType,
      entityType: 'FEEDBACK_REPORT',
      entityId: feedbackId,
      payload,
      createdAt: now,
    });
  }
}

function toFeedbackRow(
  report: typeof feedbackReports.$inferSelect,
): FeedbackRow {
  return {
    ...report,
    diagnosticSnapshot: ClientDiagnosticSnapshotSchema.parse(
      report.diagnosticSnapshot,
    ),
  };
}
