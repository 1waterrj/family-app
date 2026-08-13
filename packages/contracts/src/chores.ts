import { z } from 'zod';

import {
  ChildIdSchema,
  ChoreInstanceIdSchema,
  ChoreTemplateIdSchema,
  HouseholdIdSchema,
  IsoUtcTimestampSchema,
  MoneyCentsSchema,
  SubmissionAttemptIdSchema,
} from './common.js';

export const CHORE_IMAGE_KEYS = [
  'tidy-toys',
  'dishes',
  'set-table',
  'laundry',
  'feed-pet',
  'make-bed',
  'wipe-counter',
  'help-garden',
] as const;

export const ChoreImageKeySchema = z.enum(CHORE_IMAGE_KEYS);

export const ChoreStatusSchema = z.enum([
  'AVAILABLE',
  'CLAIMED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'CLOSED',
]);

export const CreateChoreTemplateSchema = z.object({
  householdId: HouseholdIdSchema,
  name: z.string().trim().min(1).max(120),
  imageKey: ChoreImageKeySchema,
  imageUrl: z.url().optional(),
  instructions: z.string().trim().min(1).max(2_000),
  defaultValueCents: MoneyCentsSchema.nonnegative(),
  defaultDurationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  idempotencyKey: z.uuid(),
});

export const ChoreTemplateSchema = z.object({
  id: ChoreTemplateIdSchema,
  householdId: HouseholdIdSchema,
  name: z.string(),
  imageKey: ChoreImageKeySchema.nullable(),
  imageUrl: z.url().nullable(),
  instructions: z.string(),
  defaultValueCents: MoneyCentsSchema,
  defaultDurationMinutes: z.number().int().positive(),
  isActive: z.boolean(),
  createdAt: IsoUtcTimestampSchema,
});

export const PublishChoreInstanceSchema = z.object({
  householdId: HouseholdIdSchema,
  choreTemplateId: ChoreTemplateIdSchema,
  valueCents: MoneyCentsSchema.nonnegative().optional(),
  instructions: z.string().trim().min(1).max(2_000).optional(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
  idempotencyKey: z.uuid(),
});

const idempotencyKeySchema = z.uuid();
const choreCommandSchema = z.object({
  choreInstanceId: ChoreInstanceIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const ClaimChoreSchema = choreCommandSchema.extend({
  childId: ChildIdSchema,
});

export const SubmitChoreSchema = choreCommandSchema.extend({
  childId: ChildIdSchema,
});

export const ExtendChoreClaimSchema = choreCommandSchema.extend({
  additionalMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const CancelChoreClaimSchema = choreCommandSchema.extend({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const ApproveChoreSchema = choreCommandSchema.extend({
  submissionAttemptId: SubmissionAttemptIdSchema,
  payoutCents: MoneyCentsSchema.nonnegative().optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

export const RejectChoreSchema = choreCommandSchema.extend({
  submissionAttemptId: SubmissionAttemptIdSchema,
  retry: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const ChoreInstanceSchema = z.object({
  id: ChoreInstanceIdSchema,
  householdId: HouseholdIdSchema,
  choreTemplateId: ChoreTemplateIdSchema,
  name: z.string(),
  imageKey: ChoreImageKeySchema.nullable(),
  imageUrl: z.url().nullable(),
  instructions: z.string(),
  valueCents: MoneyCentsSchema,
  durationMinutes: z.number().int().positive(),
  status: ChoreStatusSchema,
  claimedChildId: ChildIdSchema.nullable(),
  claimDeadlineAt: IsoUtcTimestampSchema.nullable(),
  submittedAt: IsoUtcTimestampSchema.nullable(),
  createdAt: IsoUtcTimestampSchema,
});

export const ChoreDecisionResultSchema = z.object({
  decisionId: z.uuid(),
  submissionAttemptId: SubmissionAttemptIdSchema,
  decision: z.enum(['APPROVED', 'REJECTED']),
  payoutCents: MoneyCentsSchema.nonnegative().nullable(),
  note: z.string().nullable(),
  choreInstance: ChoreInstanceSchema,
});

export const ChoreSubmissionResultSchema = ChoreInstanceSchema.extend({
  submissionAttemptId: SubmissionAttemptIdSchema,
});

export type ChoreStatus = z.infer<typeof ChoreStatusSchema>;
export type ChoreImageKey = z.infer<typeof ChoreImageKeySchema>;
export type CreateChoreTemplate = z.infer<typeof CreateChoreTemplateSchema>;
export type ChoreTemplate = z.infer<typeof ChoreTemplateSchema>;
export type PublishChoreInstance = z.infer<typeof PublishChoreInstanceSchema>;
export type ClaimChore = z.infer<typeof ClaimChoreSchema>;
export type SubmitChore = z.infer<typeof SubmitChoreSchema>;
export type ExtendChoreClaim = z.infer<typeof ExtendChoreClaimSchema>;
export type CancelChoreClaim = z.infer<typeof CancelChoreClaimSchema>;
export type ApproveChore = z.infer<typeof ApproveChoreSchema>;
export type RejectChore = z.infer<typeof RejectChoreSchema>;
export type ChoreInstance = z.infer<typeof ChoreInstanceSchema>;
export type ChoreDecisionResult = z.infer<typeof ChoreDecisionResultSchema>;
export type ChoreSubmissionResult = z.infer<typeof ChoreSubmissionResultSchema>;
