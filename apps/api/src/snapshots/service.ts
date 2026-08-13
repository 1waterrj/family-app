import {
  ChildProfileSchema,
  ChoreInstanceSchema,
  ChoreTemplateSchema,
  DashboardChoreSchema,
  DashboardSnapshotSchema,
  HouseholdSchema,
  ParentSnapshotSchema,
  type DashboardSnapshot,
  type ParentSnapshot,
} from '@family/contracts';

import {
  ActorContextError,
  type ActorContext,
  type DashboardActorContext,
  type ParentActorContext,
  requireDashboard,
  requireParent,
} from '../auth/actor-context.js';
import type { Clock } from '../chores/service.js';
import type { Database } from '../db/client.js';
import type { DatabaseTransaction } from '../db/transaction.js';
import { SnapshotRepository } from './repository.js';

export class SnapshotService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly repository = new SnapshotRepository(),
  ) {}

  async getParentSnapshot(actor: ActorContext): Promise<ParentSnapshot> {
    const parent = requireParent(actor);

    return this.database.transaction(
      async (transaction) => this.buildParentSnapshot(transaction, parent),
      { isolationLevel: 'repeatable read' },
    );
  }

  async getDashboardSnapshot(actor: ActorContext): Promise<DashboardSnapshot> {
    const dashboard = requireDashboard(actor);

    return this.database.transaction(
      async (transaction) =>
        this.buildDashboardSnapshot(transaction, dashboard),
      { isolationLevel: 'repeatable read' },
    );
  }

  private async buildParentSnapshot(
    transaction: DatabaseTransaction,
    parent: ParentActorContext,
  ): Promise<ParentSnapshot> {
    const membership = await this.repository.findParentMembership(
      transaction,
      parent.householdId,
      parent.actorId,
    );
    if (!membership) {
      throw notFound();
    }
    const household = await this.repository.findHousehold(
      transaction,
      parent.householdId,
    );
    if (!household) {
      throw notFound();
    }
    const children = await this.repository.listChildrenWithBalances(
      transaction,
      parent.householdId,
    );
    const templates = await this.repository.listActiveTemplates(
      transaction,
      parent.householdId,
    );
    const chores = await this.repository.listOpenChores(
      transaction,
      parent.householdId,
    );
    const pendingApprovals = await this.repository.listPendingApprovals(
      transaction,
      parent.householdId,
    );

    return ParentSnapshotSchema.parse({
      household: toHousehold(household),
      serverTime: this.clock.now().toISOString(),
      children: children.map(toChildWithBalance),
      templates: templates.map(toChoreTemplate),
      chores: chores.map(toChoreInstance),
      pendingApprovals: pendingApprovals.map((pending) => ({
        submissionAttemptId: pending.submissionAttemptId,
        child: toChildProfile(pending.child),
        chore: toChoreInstance(pending.chore),
        claimedAt: pending.claimedAt?.toISOString() ?? null,
        submittedAt: pending.submittedAt.toISOString(),
      })),
    });
  }

  private async buildDashboardSnapshot(
    transaction: DatabaseTransaction,
    dashboard: DashboardActorContext,
  ): Promise<DashboardSnapshot> {
    const device = await this.repository.findDashboardDevice(
      transaction,
      dashboard.householdId,
      dashboard.actorId,
    );
    if (!device) {
      throw notFound();
    }
    const household = await this.repository.findHousehold(
      transaction,
      dashboard.householdId,
    );
    if (!household) {
      throw notFound();
    }
    const children = await this.repository.listChildrenWithBalances(
      transaction,
      dashboard.householdId,
    );
    const chores = await this.repository.listOpenChores(
      transaction,
      dashboard.householdId,
    );

    return DashboardSnapshotSchema.parse({
      household: {
        id: household.id,
        name: household.name,
        timeZone: household.timeZone,
      },
      serverTime: this.clock.now().toISOString(),
      children: children.map(toChildWithBalance),
      chores: chores.map(toDashboardChore),
    });
  }
}

function toHousehold(
  household: typeof import('../db/schema.js').households.$inferSelect,
) {
  return HouseholdSchema.parse({
    id: household.id,
    name: household.name,
    timeZone: household.timeZone,
    createdAt: household.createdAt.toISOString(),
  });
}

function toChildProfile(
  child: typeof import('../db/schema.js').childProfiles.$inferSelect,
) {
  return ChildProfileSchema.parse({
    id: child.id,
    householdId: child.householdId,
    name: child.name,
    color: child.color,
    imageUrl: child.imageUrl,
    createdAt: child.createdAt.toISOString(),
  });
}

function toChildWithBalance(
  child: Awaited<
    ReturnType<SnapshotRepository['listChildrenWithBalances']>
  >[number],
) {
  return {
    profile: toChildProfile(child.profile),
    balanceCents: Number(child.balanceCents),
  };
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
  chore: typeof import('../db/schema.js').choreInstances.$inferSelect,
) {
  return ChoreInstanceSchema.parse({
    id: chore.id,
    householdId: chore.householdId,
    choreTemplateId: chore.choreTemplateId,
    name: chore.name,
    imageKey: chore.imageKey,
    imageUrl: chore.imageUrl,
    instructions: chore.instructions,
    valueCents: chore.valueCents,
    durationMinutes: chore.durationSeconds / 60,
    status: chore.status,
    claimedChildId: chore.claimedByChildId,
    claimDeadlineAt: chore.claimDeadlineAt?.toISOString() ?? null,
    submittedAt: chore.submittedAt?.toISOString() ?? null,
    createdAt: chore.createdAt.toISOString(),
  });
}

function toDashboardChore(
  chore: typeof import('../db/schema.js').choreInstances.$inferSelect,
) {
  return DashboardChoreSchema.parse({
    id: chore.id,
    choreTemplateId: chore.choreTemplateId,
    name: chore.name,
    imageKey: chore.imageKey,
    imageUrl: chore.imageUrl,
    instructions: chore.instructions,
    valueCents: chore.valueCents,
    durationMinutes: chore.durationSeconds / 60,
    status: chore.status,
    claimedChildId: chore.claimedByChildId,
    claimDeadlineAt: chore.claimDeadlineAt?.toISOString() ?? null,
    submittedAt: chore.submittedAt?.toISOString() ?? null,
    createdAt: chore.createdAt.toISOString(),
  });
}

function notFound(): ActorContextError {
  return new ActorContextError('NOT_FOUND', 'Resource not found.');
}
