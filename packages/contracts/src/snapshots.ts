import { z } from 'zod';

import { ChoreInstanceSchema, ChoreTemplateSchema } from './chores.js';
import {
  IsoUtcTimestampSchema,
  LedgerBalanceCentsSchema,
  SubmissionAttemptIdSchema,
} from './common.js';
import { ChildProfileSchema, HouseholdSchema } from './households.js';

const SnapshotChildSchema = z
  .object({
    profile: ChildProfileSchema.strict(),
    balanceCents: LedgerBalanceCentsSchema,
  })
  .strict();

const PendingApprovalSchema = z
  .object({
    submissionAttemptId: SubmissionAttemptIdSchema,
    child: ChildProfileSchema.strict(),
    chore: ChoreInstanceSchema.strict(),
    claimedAt: IsoUtcTimestampSchema.nullable(),
    submittedAt: IsoUtcTimestampSchema,
  })
  .strict();

export const DashboardChoreSchema = ChoreInstanceSchema.pick({
  id: true,
  choreTemplateId: true,
  name: true,
  imageKey: true,
  imageUrl: true,
  instructions: true,
  valueCents: true,
  durationMinutes: true,
  status: true,
  claimedChildId: true,
  claimDeadlineAt: true,
  submittedAt: true,
  createdAt: true,
}).strict();

export const ParentSnapshotSchema = z
  .object({
    household: HouseholdSchema.strict(),
    serverTime: IsoUtcTimestampSchema,
    children: z.array(SnapshotChildSchema),
    templates: z.array(ChoreTemplateSchema.strict()),
    chores: z.array(ChoreInstanceSchema.strict()),
    pendingApprovals: z.array(PendingApprovalSchema),
  })
  .strict();

export const DashboardSnapshotSchema = z
  .object({
    household: HouseholdSchema.pick({
      id: true,
      name: true,
      timeZone: true,
    }).strict(),
    serverTime: IsoUtcTimestampSchema,
    children: z.array(SnapshotChildSchema),
    chores: z.array(DashboardChoreSchema),
  })
  .strict();

export type DashboardChore = z.infer<typeof DashboardChoreSchema>;
export type ParentSnapshot = z.infer<typeof ParentSnapshotSchema>;
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
