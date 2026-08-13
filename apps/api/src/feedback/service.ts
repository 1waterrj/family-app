import {
  ClientDiagnosticSnapshotSchema,
  DeletedFeedbackSchema,
  FeedbackListItemSchema,
  FeedbackPublicPreviewRequestSchema,
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  FeedbackSubmissionReceiptSchema,
  type CreateFeedbackCommand,
  type DeleteFeedbackCommand,
  type FeedbackCategory,
  type FeedbackDiagnosticEvent,
  type FeedbackPublicPreviewRequest,
  type FeedbackScreen,
  type FeedbackSource,
  type UpdateFeedbackCommand,
} from '@family/contracts';

import {
  ActorContextError,
  type ActorContext,
  requireParent,
} from '../auth/actor-context.js';
import type { Database } from '../db/client.js';
import type { DatabaseTransaction } from '../db/transaction.js';
import { IdempotentCommandExecutor } from '../idempotency/executor.js';
import {
  FeedbackRepository,
  type FeedbackRow,
  type FeedbackUpdatePatch,
} from './repository.js';
import {
  buildPublicFeedbackPreview,
  findingsForFeedbackField,
} from './privacy.js';

export const DASHBOARD_FEEDBACK_LIMIT = 5;
export const DASHBOARD_FEEDBACK_WINDOW_MS = 10 * 60 * 1_000;

const DESCRIPTION_PREVIEW_LENGTH = 160;

export interface FeedbackClock {
  now(): Date;
}

export class FeedbackServiceError extends Error {
  constructor(
    readonly code:
      'VALIDATION_ERROR' | 'RATE_LIMITED' | 'INVALID_STATE' | 'CONFLICT',
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'FeedbackServiceError';
  }
}

export class FeedbackService {
  constructor(
    private readonly database: Database,
    private readonly clock: FeedbackClock,
    private readonly githubRepository?: string,
    private readonly repository = new FeedbackRepository(),
    private readonly idempotency = new IdempotentCommandExecutor(
      database,
      undefined,
      () => clock.now(),
    ),
  ) {}

  async createFeedback(actor: ActorContext, command: CreateFeedbackCommand) {
    return this.idempotency.execute({
      actor,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_FEEDBACK',
      request: command,
      responseSchema: FeedbackSubmissionReceiptSchema,
      authorize: async (transaction) =>
        this.requireCurrentActor(transaction, actor),
      isolationLevel:
        actor.role === 'DASHBOARD' ? 'read committed' : 'serializable',
      work: async (transaction) => this.createOnce(transaction, actor, command),
    });
  }

  async listFeedback(actor: ActorContext) {
    const parent = requireParent(actor);
    return this.database.transaction(
      async (transaction) => {
        await this.requireCurrentActor(transaction, parent);
        const reports = await this.repository.listByHousehold(
          transaction,
          parent.householdId,
        );
        return reports.map(toListItem);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async getFeedback(actor: ActorContext, feedbackId: string) {
    const parent = requireParent(actor);
    return this.database.transaction(
      async (transaction) => {
        await this.requireCurrentActor(transaction, parent);
        const report = await this.repository.findByHousehold(
          transaction,
          parent.householdId,
          feedbackId,
        );
        if (!report) {
          throw notFound();
        }
        const knownTerms = await this.repository.listKnownPrivateTerms(
          transaction,
          parent.householdId,
        );
        return toReport(report, knownTerms);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async updateFeedback(
    actor: ActorContext,
    feedbackId: string,
    command: UpdateFeedbackCommand,
  ) {
    const parent = requireParent(actor);
    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: command.idempotencyKey,
      operation: 'UPDATE_FEEDBACK',
      request: { feedbackId, ...command },
      responseSchema: FeedbackReportSchema,
      authorize: async (transaction) =>
        this.requireCurrentActor(transaction, parent),
      work: async (transaction) => {
        const current = await this.repository.findByHousehold(
          transaction,
          parent.householdId,
          feedbackId,
        );
        if (!current) {
          throw notFound();
        }

        const updatedAt = nextRevision(this.clock.now(), current.updatedAt);
        const patch = this.buildUpdatePatch(
          current,
          command,
          parent.actorId,
          updatedAt,
        );
        const updated = await this.repository.update(
          transaction,
          parent.householdId,
          feedbackId,
          new Date(command.expectedUpdatedAt),
          patch,
        );
        if (!updated) {
          throw new FeedbackServiceError(
            'CONFLICT',
            'Feedback changed on the server. Load the latest copy before saving again.',
          );
        }
        const knownTerms = await this.repository.listKnownPrivateTerms(
          transaction,
          parent.householdId,
        );
        await this.repository.insertAuditEvent(
          transaction,
          parent,
          feedbackId,
          'FEEDBACK_UPDATED',
          auditMetadata(updated),
          updatedAt,
        );
        return toReport(updated, knownTerms);
      },
    });
  }

  async preparePublicPreview(
    actor: ActorContext,
    feedbackId: string,
    rawInput: FeedbackPublicPreviewRequest,
  ) {
    const parent = requireParent(actor);
    const input = FeedbackPublicPreviewRequestSchema.parse(rawInput);
    return this.database.transaction(
      async (transaction) => {
        await this.requireCurrentActor(transaction, parent);
        const report = await this.repository.findByHousehold(
          transaction,
          parent.householdId,
          feedbackId,
        );
        if (!report) throw notFound();
        if (!this.githubRepository) {
          throw new FeedbackServiceError(
            'INVALID_STATE',
            'Public feedback preview is not configured.',
          );
        }
        const knownTerms = await this.repository.listKnownPrivateTerms(
          transaction,
          parent.householdId,
        );
        return FeedbackPublicPreviewSchema.parse(
          buildPublicFeedbackPreview({
            report,
            input,
            knownTerms,
            repository: this.githubRepository,
          }),
        );
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async deleteFeedback(
    actor: ActorContext,
    feedbackId: string,
    command: DeleteFeedbackCommand,
  ) {
    const parent = requireParent(actor);
    return this.idempotency.execute({
      actor: parent,
      idempotencyKey: command.idempotencyKey,
      operation: 'DELETE_FEEDBACK',
      request: { feedbackId, ...command },
      responseSchema: DeletedFeedbackSchema,
      authorize: async (transaction) =>
        this.requireCurrentActor(transaction, parent),
      work: async (transaction) => {
        const deleted = await this.repository.delete(
          transaction,
          parent.householdId,
          feedbackId,
        );
        if (!deleted) {
          throw notFound();
        }

        const deletedAt = this.clock.now();
        await this.repository.insertAuditEvent(
          transaction,
          parent,
          feedbackId,
          'FEEDBACK_DELETED',
          auditMetadata(deleted),
          deletedAt,
        );
        return DeletedFeedbackSchema.parse({ id: feedbackId, deleted: true });
      },
    });
  }

  private async createOnce(
    transaction: DatabaseTransaction,
    actor: ActorContext,
    command: CreateFeedbackCommand,
  ) {
    assertDiagnosticOwnership(actor, command);

    const createdAt = this.clock.now();
    if (actor.role === 'DASHBOARD') {
      const since = new Date(
        createdAt.getTime() - DASHBOARD_FEEDBACK_WINDOW_MS,
      );
      const recentCount = await this.repository.countDashboardSubmissionsSince(
        transaction,
        actor.householdId,
        actor.actorId,
        since,
      );
      if (recentCount >= DASHBOARD_FEEDBACK_LIMIT) {
        throw new FeedbackServiceError(
          'RATE_LIMITED',
          'Please wait before sending more feedback.',
        );
      }
    }

    const created = await this.repository.insert(
      transaction,
      actor,
      command,
      createdAt,
      defaultTitle(command.category, command.diagnosticSnapshot.source),
    );
    await this.repository.insertAuditEvent(
      transaction,
      actor,
      created.id,
      'FEEDBACK_CREATED',
      auditMetadata(created),
      createdAt,
    );
    return FeedbackSubmissionReceiptSchema.parse({
      id: created.id,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    });
  }

  private async requireCurrentActor(
    transaction: DatabaseTransaction,
    actor: ActorContext,
  ): Promise<void> {
    if (!(await this.repository.findSubmittingActor(transaction, actor))) {
      throw notFound();
    }
  }

  private buildUpdatePatch(
    current: FeedbackRow,
    command: UpdateFeedbackCommand,
    reviewerParentId: string,
    updatedAt: Date,
  ): FeedbackUpdatePatch {
    const patch: FeedbackUpdatePatch = {
      title: command.title,
      description: command.description,
      status: command.status,
      publicIssueUrl: command.publicIssueUrl,
      updatedAt,
    };

    if (command.diagnosticEvents !== undefined) {
      assertScreenEvents(
        current.diagnosticSnapshot.source,
        command.diagnosticEvents,
        'body.diagnosticEvents',
      );
      patch.diagnosticSnapshot = ClientDiagnosticSnapshotSchema.parse({
        source: current.diagnosticSnapshot.source,
        appVersion: current.diagnosticSnapshot.appVersion,
        currentScreen: current.diagnosticSnapshot.currentScreen,
        events: command.diagnosticEvents,
      });
    }

    const resultingStatus = command.status ?? current.status;
    const statusChanged =
      command.status !== undefined && command.status !== current.status;
    const terminalEdit =
      !statusChanged &&
      (current.status === 'EXPORTED' || current.status === 'CLOSED');
    if (!terminalEdit) {
      patch.reviewedByParentId = reviewerParentId;
      patch.reviewedAt = updatedAt;
    }
    if (statusChanged) {
      patch.exportedAt = resultingStatus === 'EXPORTED' ? updatedAt : null;
      patch.closedAt = resultingStatus === 'CLOSED' ? updatedAt : null;
    }

    return patch;
  }
}

function nextRevision(now: Date, current: Date): Date {
  return new Date(Math.max(now.getTime(), current.getTime() + 1));
}

function assertDiagnosticOwnership(
  actor: ActorContext,
  command: CreateFeedbackCommand,
): void {
  const snapshot = command.diagnosticSnapshot;
  const sourceMatches =
    actor.role === 'PARENT'
      ? snapshot.source === 'PARENT_IOS' || snapshot.source === 'PARENT_ANDROID'
      : snapshot.source === 'DASHBOARD';
  if (!sourceMatches) {
    throw validationError(
      'body.diagnosticSnapshot.source',
      'Feedback source must match the authenticated application.',
    );
  }

  if (!screenMatchesSource(snapshot.source, snapshot.currentScreen)) {
    throw validationError(
      'body.diagnosticSnapshot.currentScreen',
      'Feedback screen must match the authenticated application.',
    );
  }

  assertScreenEvents(
    snapshot.source,
    snapshot.events,
    'body.diagnosticSnapshot.events',
  );
}

function screenMatchesSource(
  source: FeedbackSource,
  screen: FeedbackScreen,
): boolean {
  return (
    screen === 'SETUP' ||
    (source === 'PARENT_IOS' || source === 'PARENT_ANDROID'
      ? screen.startsWith('PARENT_')
      : screen.startsWith('DASHBOARD_'))
  );
}

function assertScreenEvents(
  source: FeedbackSource,
  events: readonly FeedbackDiagnosticEvent[],
  path: string,
): void {
  for (const [index, event] of events.entries()) {
    if (event.kind === 'SCREEN' && !screenMatchesSource(source, event.screen)) {
      throw validationError(
        `${path}.${index}.screen`,
        'Feedback screen must match the authenticated application.',
      );
    }
  }
}

function validationError(path: string, message: string): FeedbackServiceError {
  return new FeedbackServiceError(
    'VALIDATION_ERROR',
    'The request is invalid.',
    {
      [path]: [message],
    },
  );
}

function defaultTitle(
  category: FeedbackCategory,
  source: FeedbackSource,
): string {
  const categoryLabel = {
    BROKEN: 'Something broke',
    CONFUSING: 'Something is confusing',
    IDEA: 'New idea',
  }[category];
  const sourceLabel = {
    PARENT_IOS: 'Parent iOS',
    PARENT_ANDROID: 'Parent Android',
    DASHBOARD: 'Dashboard',
  }[source];
  return `${categoryLabel} — ${sourceLabel}`;
}

function toListItem(report: FeedbackRow) {
  const descriptionPreview =
    report.description.length <= DESCRIPTION_PREVIEW_LENGTH
      ? report.description
      : `${report.description.slice(0, DESCRIPTION_PREVIEW_LENGTH - 3)}...`;
  return FeedbackListItemSchema.parse({
    id: report.id,
    category: report.category,
    source: report.source,
    appVersion: report.appVersion,
    screen: report.screen,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    descriptionPreview,
    hasDiagnostics: report.diagnosticSnapshot.events.length > 0,
  });
}

function toReport(report: FeedbackRow, knownTerms: readonly string[]) {
  return FeedbackReportSchema.parse({
    id: report.id,
    category: report.category,
    source: report.source,
    appVersion: report.appVersion,
    screen: report.screen,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    title: report.title,
    description: report.description,
    diagnosticSnapshot: report.diagnosticSnapshot,
    privacyFindings: [
      ...findingsForFeedbackField('TITLE', report.title, knownTerms),
      ...findingsForFeedbackField(
        'DESCRIPTION',
        report.description,
        knownTerms,
      ),
    ],
    publicIssueUrl: report.publicIssueUrl,
    reviewedAt: report.reviewedAt?.toISOString() ?? null,
    exportedAt: report.exportedAt?.toISOString() ?? null,
    closedAt: report.closedAt?.toISOString() ?? null,
  });
}

function auditMetadata(report: FeedbackRow) {
  return {
    category: report.category,
    source: report.source,
    status: report.status,
  };
}

function notFound(): ActorContextError {
  return new ActorContextError('NOT_FOUND', 'Resource not found.');
}
