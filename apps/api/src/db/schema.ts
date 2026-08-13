import type {
  ActorRole,
  ChoreImageKey,
  ChoreStatus,
  FeedbackCategory,
  FeedbackSource,
  FeedbackStatus,
  LedgerTransactionType,
} from '@family/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const actorRoleValues = [
  'PARENT',
  'DASHBOARD',
  'SYSTEM',
] as const satisfies readonly ActorRole[];
const choreStatusValues = [
  'AVAILABLE',
  'CLAIMED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'CLOSED',
] as const satisfies readonly ChoreStatus[];
const ledgerTransactionTypeValues = [
  'CHORE_CREDIT',
  'PURCHASE',
  'MANUAL_CREDIT',
  'CORRECTION',
] as const satisfies readonly LedgerTransactionType[];
const feedbackCategoryValues = [
  'BROKEN',
  'CONFUSING',
  'IDEA',
] as const satisfies readonly FeedbackCategory[];
const feedbackSourceValues = [
  'PARENT_IOS',
  'PARENT_ANDROID',
  'DASHBOARD',
] as const satisfies readonly FeedbackSource[];
const feedbackStatusValues = [
  'NEW',
  'REVIEWING',
  'READY',
  'EXPORTED',
  'CLOSED',
] as const satisfies readonly FeedbackStatus[];

export const actorRoleEnum = pgEnum('actor_role', actorRoleValues);
export const choreStatusEnum = pgEnum('chore_status', choreStatusValues);
export const ledgerTransactionTypeEnum = pgEnum(
  'ledger_transaction_type',
  ledgerTransactionTypeValues,
);
export const approvalDecisionEnum = pgEnum('approval_decision', [
  'APPROVED',
  'REJECTED',
]);
export const feedbackCategoryEnum = pgEnum(
  'feedback_category',
  feedbackCategoryValues,
);
export const feedbackSourceEnum = pgEnum(
  'feedback_source',
  feedbackSourceValues,
);
export const feedbackStatusEnum = pgEnum(
  'feedback_status',
  feedbackStatusValues,
);

export const households = pgTable('households', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  timeZone: varchar('time_zone', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const parentMemberships = pgTable(
  'parent_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('parent_memberships_household_parent_unique').on(
      table.householdId,
      table.parentId,
    ),
  ],
);

export const childProfiles = pgTable(
  'child_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    color: varchar('color', { length: 32 }).notNull(),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('child_profiles_household_id_unique').on(
      table.householdId,
      table.id,
    ),
  ],
);

export const dashboardDevices = pgTable(
  'dashboard_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('dashboard_devices_household_id_unique').on(
      table.householdId,
      table.id,
    ),
  ],
);

export const feedbackReports = pgTable(
  'feedback_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    submittedByRole: actorRoleEnum('submitted_by_role').notNull(),
    submittedByParentId: uuid('submitted_by_parent_id'),
    submittedByDashboardDeviceId: uuid('submitted_by_dashboard_device_id'),
    category: feedbackCategoryEnum('category').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    description: text('description').notNull(),
    source: feedbackSourceEnum('source').notNull(),
    appVersion: varchar('app_version', { length: 160 }).notNull(),
    screen: varchar('screen', { length: 64 }).notNull(),
    diagnosticSnapshot: jsonb('diagnostic_snapshot').notNull(),
    status: feedbackStatusEnum('status').default('NEW').notNull(),
    reviewedByParentId: uuid('reviewed_by_parent_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    publicIssueUrl: text('public_issue_url'),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('feedback_reports_household_id_unique').on(
      table.householdId,
      table.id,
    ),
    foreignKey({
      columns: [table.householdId, table.submittedByParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'feedback_reports_household_submitter_parent_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.submittedByDashboardDeviceId],
      foreignColumns: [dashboardDevices.householdId, dashboardDevices.id],
      name: 'feedback_reports_household_submitter_dashboard_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.reviewedByParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'feedback_reports_household_reviewer_parent_fk',
    }),
    check(
      'feedback_reports_role_actor_match',
      sql`(
        (${table.submittedByRole} = 'PARENT' AND ${table.submittedByParentId} IS NOT NULL AND ${table.submittedByDashboardDeviceId} IS NULL)
        OR
        (${table.submittedByRole} = 'DASHBOARD' AND ${table.submittedByParentId} IS NULL AND ${table.submittedByDashboardDeviceId} IS NOT NULL)
      )`,
    ),
    check(
      'feedback_reports_description_length',
      sql`char_length(${table.description}) <= 2000`,
    ),
    check(
      'feedback_reports_diagnostic_snapshot_valid',
      sql`feedback_diagnostic_snapshot_is_valid(${table.diagnosticSnapshot})`,
    ),
    check(
      'feedback_reports_diagnostic_metadata_match',
      sql`(
        ${table.diagnosticSnapshot}->>'source' = ${table.source}::text
        AND ${table.diagnosticSnapshot}->>'appVersion' = ${table.appVersion}
        AND ${table.diagnosticSnapshot}->>'currentScreen' = ${table.screen}
      )`,
    ),
    check(
      'feedback_reports_reviewer_pair',
      sql`(
        (${table.reviewedByParentId} IS NULL AND ${table.reviewedAt} IS NULL)
        OR
        (${table.reviewedByParentId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)
      )`,
    ),
    check(
      'feedback_reports_status_lifecycle_match',
      sql`(
        (${table.status} = 'NEW' AND ${table.exportedAt} IS NULL AND ${table.closedAt} IS NULL)
        OR
        (${table.status} IN ('REVIEWING', 'READY') AND ${table.reviewedAt} IS NOT NULL AND ${table.exportedAt} IS NULL AND ${table.closedAt} IS NULL)
        OR
        (${table.status} = 'EXPORTED' AND ${table.reviewedAt} IS NOT NULL AND ${table.exportedAt} IS NOT NULL AND ${table.closedAt} IS NULL)
        OR
        (${table.status} = 'CLOSED' AND ${table.reviewedAt} IS NOT NULL AND ${table.exportedAt} IS NULL AND ${table.closedAt} IS NOT NULL)
      )`,
    ),
    check(
      'feedback_reports_lifecycle_chronology',
      sql`(
        ${table.updatedAt} >= ${table.createdAt}
        AND (${table.reviewedAt} IS NULL OR (${table.reviewedAt} >= ${table.createdAt} AND ${table.reviewedAt} <= ${table.updatedAt}))
        AND (${table.exportedAt} IS NULL OR (${table.exportedAt} >= ${table.createdAt} AND ${table.exportedAt} <= ${table.updatedAt} AND ${table.reviewedAt} <= ${table.exportedAt}))
        AND (${table.closedAt} IS NULL OR (${table.closedAt} >= ${table.createdAt} AND ${table.closedAt} <= ${table.updatedAt} AND ${table.reviewedAt} <= ${table.closedAt}))
      )`,
    ),
    index('feedback_reports_household_status_created_at_idx').on(
      table.householdId,
      table.status,
      table.createdAt,
    ),
    index('feedback_reports_household_created_at_id_idx').on(
      table.householdId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('feedback_reports_household_status_closed_at_idx').on(
      table.householdId,
      table.status,
      table.closedAt,
    ),
    index('feedback_reports_dashboard_actor_created_at_idx').on(
      table.householdId,
      table.submittedByDashboardDeviceId,
      table.createdAt,
    ),
  ],
);

export const choreTemplates = pgTable(
  'chore_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdByParentId: uuid('created_by_parent_id'),
    name: varchar('name', { length: 120 }).notNull(),
    imageKey: varchar('image_key', { length: 64 }).$type<ChoreImageKey>(),
    imageUrl: text('image_url'),
    instructions: text('instructions').notNull(),
    defaultValueCents: integer('default_value_cents').notNull(),
    defaultDurationSeconds: integer('default_duration_seconds').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('chore_templates_household_id_unique').on(
      table.householdId,
      table.id,
    ),
    foreignKey({
      columns: [table.householdId, table.createdByParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'chore_templates_household_parent_fk',
    }),
    check(
      'chore_templates_default_value_cents_nonnegative',
      sql`${table.defaultValueCents} >= 0`,
    ),
    check(
      'chore_templates_default_duration_seconds_range',
      sql`${table.defaultDurationSeconds} BETWEEN 60 AND 86400`,
    ),
    check(
      'chore_templates_image_key_known',
      sql`${table.imageKey} IS NULL OR ${table.imageKey} IN ('tidy-toys', 'dishes', 'set-table', 'laundry', 'feed-pet', 'make-bed', 'wipe-counter', 'help-garden')`,
    ),
  ],
);

export const choreInstances = pgTable(
  'chore_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    choreTemplateId: uuid('chore_template_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    imageKey: varchar('image_key', { length: 64 }).$type<ChoreImageKey>(),
    imageUrl: text('image_url'),
    instructions: text('instructions').notNull(),
    valueCents: integer('value_cents').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    status: choreStatusEnum('status').default('AVAILABLE').notNull(),
    claimedByChildId: uuid('claimed_by_child_id'),
    claimDeadlineAt: timestamp('claim_deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('chore_instances_household_id_unique').on(
      table.householdId,
      table.id,
    ),
    foreignKey({
      columns: [table.householdId, table.choreTemplateId],
      foreignColumns: [choreTemplates.householdId, choreTemplates.id],
      name: 'chore_instances_household_template_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.claimedByChildId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: 'chore_instances_household_child_fk',
    }),
    check(
      'chore_instances_value_cents_nonnegative',
      sql`${table.valueCents} >= 0`,
    ),
    check(
      'chore_instances_duration_seconds_range',
      sql`${table.durationSeconds} BETWEEN 60 AND 86400`,
    ),
    check(
      'chore_instances_image_key_known',
      sql`${table.imageKey} IS NULL OR ${table.imageKey} IN ('tidy-toys', 'dishes', 'set-table', 'laundry', 'feed-pet', 'make-bed', 'wipe-counter', 'help-garden')`,
    ),
    index('chore_instances_household_status_idx').on(
      table.householdId,
      table.status,
    ),
    index('chore_instances_household_child_created_at_idx').on(
      table.householdId,
      table.claimedByChildId,
      table.createdAt,
    ),
    index('chore_instances_claim_expiration_idx')
      .on(table.householdId, table.claimDeadlineAt)
      .where(sql`${table.status} = 'CLAIMED'`),
  ],
);

export const choreSubmissionAttempts = pgTable(
  'chore_submission_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    choreInstanceId: uuid('chore_instance_id').notNull(),
    claimedByChildId: uuid('claimed_by_child_id'),
    attemptNumber: integer('attempt_number').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('chore_submission_attempts_household_id_unique').on(
      table.householdId,
      table.id,
      table.choreInstanceId,
    ),
    unique('chore_submission_attempts_household_chore_number_unique').on(
      table.householdId,
      table.choreInstanceId,
      table.attemptNumber,
    ),
    foreignKey({
      columns: [table.householdId, table.choreInstanceId],
      foreignColumns: [choreInstances.householdId, choreInstances.id],
      name: 'chore_submission_attempts_household_chore_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.claimedByChildId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: 'chore_submission_attempts_household_child_fk',
    }),
    check(
      'chore_submission_attempts_claimant_required',
      sql`${table.claimedByChildId} IS NOT NULL`,
    ),
    check(
      'chore_submission_attempts_number_positive',
      sql`${table.attemptNumber} > 0`,
    ),
    index('chore_submission_attempts_household_chore_number_idx').on(
      table.householdId,
      table.choreInstanceId,
      table.attemptNumber,
    ),
  ],
);

export const choreTransitions = pgTable(
  'chore_transitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    choreInstanceId: uuid('chore_instance_id').notNull(),
    fromStatus: choreStatusEnum('from_status').notNull(),
    toStatus: choreStatusEnum('to_status').notNull(),
    actorRole: actorRoleEnum('actor_role').notNull(),
    actorParentId: uuid('actor_parent_id'),
    actorDashboardDeviceId: uuid('actor_dashboard_device_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.householdId, table.choreInstanceId],
      foreignColumns: [choreInstances.householdId, choreInstances.id],
      name: 'chore_transitions_household_chore_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.actorParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'chore_transitions_household_parent_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.actorDashboardDeviceId],
      foreignColumns: [dashboardDevices.householdId, dashboardDevices.id],
      name: 'chore_transitions_household_dashboard_fk',
    }),
    check(
      'chore_transitions_role_actor_match',
      sql`(
        (${table.actorRole} = 'PARENT' AND ${table.actorParentId} IS NOT NULL AND ${table.actorDashboardDeviceId} IS NULL)
        OR
        (${table.actorRole} = 'DASHBOARD' AND ${table.actorParentId} IS NULL AND ${table.actorDashboardDeviceId} IS NOT NULL)
        OR
        (${table.actorRole}::text = 'SYSTEM' AND ${table.actorParentId} IS NULL AND ${table.actorDashboardDeviceId} IS NULL)
      )`,
    ),
  ],
);

export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    choreInstanceId: uuid('chore_instance_id').notNull(),
    submissionAttemptId: uuid('submission_attempt_id').notNull(),
    decidedByParentId: uuid('decided_by_parent_id').notNull(),
    decision: approvalDecisionEnum('decision').notNull(),
    payoutCents: integer('payout_cents'),
    note: text('note'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('approval_decisions_household_id_unique').on(
      table.householdId,
      table.id,
    ),
    unique('approval_decisions_household_attempt_unique').on(
      table.householdId,
      table.submissionAttemptId,
    ),
    foreignKey({
      columns: [table.householdId, table.choreInstanceId],
      foreignColumns: [choreInstances.householdId, choreInstances.id],
      name: 'approval_decisions_household_chore_fk',
    }),
    foreignKey({
      columns: [
        table.householdId,
        table.submissionAttemptId,
        table.choreInstanceId,
      ],
      foreignColumns: [
        choreSubmissionAttempts.householdId,
        choreSubmissionAttempts.id,
        choreSubmissionAttempts.choreInstanceId,
      ],
      name: 'approval_decisions_household_attempt_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.decidedByParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'approval_decisions_household_parent_fk',
    }),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    childId: uuid('child_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    type: ledgerTransactionTypeEnum('type').notNull(),
    note: text('note'),
    actorParentId: uuid('actor_parent_id'),
    relatedChoreInstanceId: uuid('related_chore_instance_id'),
    approvalDecisionId: uuid('approval_decision_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.householdId, table.childId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: 'ledger_transactions_household_child_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.actorParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'ledger_transactions_household_parent_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.relatedChoreInstanceId],
      foreignColumns: [choreInstances.householdId, choreInstances.id],
      name: 'ledger_transactions_household_chore_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.approvalDecisionId],
      foreignColumns: [approvalDecisions.householdId, approvalDecisions.id],
      name: 'ledger_transactions_household_approval_fk',
    }),
    check(
      'ledger_transactions_amount_cents_nonzero_except_chore_credit',
      sql`${table.amountCents} <> 0 OR ${table.type} = 'CHORE_CREDIT'`,
    ),
    check(
      'ledger_transactions_type_amount_sign',
      sql`(
        (${table.type} = 'CHORE_CREDIT' AND ${table.amountCents} >= 0)
        OR (${table.type} = 'PURCHASE' AND ${table.amountCents} < 0)
        OR (${table.type} = 'MANUAL_CREDIT' AND ${table.amountCents} > 0)
        OR ${table.type} = 'CORRECTION'
      )`,
    ),
    check(
      'ledger_transactions_chore_credit_approval_match',
      sql`(
        (${table.type} = 'CHORE_CREDIT' AND ${table.approvalDecisionId} IS NOT NULL)
        OR (${table.type} <> 'CHORE_CREDIT' AND ${table.approvalDecisionId} IS NULL)
      )`,
    ),
    unique('ledger_transactions_household_approval_unique').on(
      table.householdId,
      table.approvalDecisionId,
    ),
    index('ledger_transactions_household_child_created_at_idx').on(
      table.householdId,
      table.childId,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    actorRole: actorRoleEnum('actor_role').notNull(),
    actorParentId: uuid('actor_parent_id'),
    actorDashboardDeviceId: uuid('actor_dashboard_device_id'),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.householdId, table.actorParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'audit_events_household_parent_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.actorDashboardDeviceId],
      foreignColumns: [dashboardDevices.householdId, dashboardDevices.id],
      name: 'audit_events_household_dashboard_fk',
    }),
    check(
      'audit_events_role_actor_match',
      sql`(
        (${table.actorRole} = 'PARENT' AND ${table.actorParentId} IS NOT NULL AND ${table.actorDashboardDeviceId} IS NULL)
        OR
        (${table.actorRole} = 'DASHBOARD' AND ${table.actorParentId} IS NULL AND ${table.actorDashboardDeviceId} IS NOT NULL)
      )`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    actorRole: actorRoleEnum('actor_role').notNull(),
    actorParentId: uuid('actor_parent_id'),
    actorDashboardDeviceId: uuid('actor_dashboard_device_id'),
    operation: varchar('operation', { length: 120 }).notNull(),
    requestHash: varchar('request_hash', { length: 128 }).notNull(),
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('idempotency_records_household_key_unique').on(
      table.householdId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.householdId, table.actorParentId],
      foreignColumns: [
        parentMemberships.householdId,
        parentMemberships.parentId,
      ],
      name: 'idempotency_records_household_parent_fk',
    }),
    foreignKey({
      columns: [table.householdId, table.actorDashboardDeviceId],
      foreignColumns: [dashboardDevices.householdId, dashboardDevices.id],
      name: 'idempotency_records_household_dashboard_fk',
    }),
    check(
      'idempotency_records_role_actor_match',
      sql`(
        (${table.actorRole} = 'PARENT' AND ${table.actorParentId} IS NOT NULL AND ${table.actorDashboardDeviceId} IS NULL)
        OR
        (${table.actorRole} = 'DASHBOARD' AND ${table.actorParentId} IS NULL AND ${table.actorDashboardDeviceId} IS NOT NULL)
      )`,
    ),
  ],
);
