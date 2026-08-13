import { z } from 'zod';

const uuidSchema = z.uuid();

export const HouseholdIdSchema = uuidSchema.brand<'HouseholdId'>();
export const ChildIdSchema = uuidSchema.brand<'ChildId'>();
export const ChoreTemplateIdSchema = uuidSchema.brand<'ChoreTemplateId'>();
export const ChoreInstanceIdSchema = uuidSchema.brand<'ChoreInstanceId'>();
export const SubmissionAttemptIdSchema =
  uuidSchema.brand<'SubmissionAttemptId'>();
export const ParentIdSchema = uuidSchema.brand<'ParentId'>();
export const DashboardDeviceIdSchema = uuidSchema.brand<'DashboardDeviceId'>();
export const FeedbackIdSchema = uuidSchema.brand<'FeedbackId'>();

export const MoneyCentsSchema = z
  .number()
  .int()
  .min(-2_147_483_648)
  .max(2_147_483_647);
export const LedgerBalanceCentsSchema = z.number().int().safe();
export const ActorRoleSchema = z.enum(['PARENT', 'DASHBOARD', 'SYSTEM']);
export const IsoUtcTimestampSchema = z.iso.datetime();
export const IanaTimeZoneSchema = z.string().refine(
  (value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Expected an IANA time zone' },
);

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'CHORE_UNAVAILABLE',
  'CONFLICT',
  'INVALID_STATE',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
]);

export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
});

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
  requestId: z.uuid(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

export type HouseholdId = z.infer<typeof HouseholdIdSchema>;
export type ChildId = z.infer<typeof ChildIdSchema>;
export type ChoreTemplateId = z.infer<typeof ChoreTemplateIdSchema>;
export type ChoreInstanceId = z.infer<typeof ChoreInstanceIdSchema>;
export type SubmissionAttemptId = z.infer<typeof SubmissionAttemptIdSchema>;
export type ParentId = z.infer<typeof ParentIdSchema>;
export type DashboardDeviceId = z.infer<typeof DashboardDeviceIdSchema>;
export type FeedbackId = z.infer<typeof FeedbackIdSchema>;
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;
export type LedgerBalanceCents = z.infer<typeof LedgerBalanceCentsSchema>;
export type ActorRole = z.infer<typeof ActorRoleSchema>;
export type IsoUtcTimestamp = z.infer<typeof IsoUtcTimestampSchema>;
export type IanaTimeZone = z.infer<typeof IanaTimeZoneSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
