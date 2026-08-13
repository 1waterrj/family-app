import { z } from 'zod';

import {
  ApiErrorCodeSchema,
  FeedbackIdSchema,
  IsoUtcTimestampSchema,
} from './common.js';

export const DIAGNOSTIC_WINDOW_MS = 900_000;
export const MAX_DIAGNOSTIC_EVENTS = 100;
export const MAX_DIAGNOSTIC_BYTES = 24 * 1_024;
export const MAX_FEEDBACK_DESCRIPTION_LENGTH = 2_000;
export const MAX_FEEDBACK_TITLE_LENGTH = 160;

export const FeedbackRevisionSchema = IsoUtcTimestampSchema.refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),
  'Expected a canonical UTC timestamp with millisecond precision.',
);

export const FeedbackAppVersionSchema = z
  .string()
  .max(160)
  .regex(
    /^(?:development|(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/,
    'Expected development or a safe semantic version/build string.',
  );

export const FeedbackCategorySchema = z.enum(['BROKEN', 'CONFUSING', 'IDEA']);
export const FeedbackSourceSchema = z.enum([
  'PARENT_IOS',
  'PARENT_ANDROID',
  'DASHBOARD',
]);
export const FeedbackStatusSchema = z.enum([
  'NEW',
  'REVIEWING',
  'READY',
  'EXPORTED',
  'CLOSED',
]);
export const FeedbackScreenSchema = z.enum([
  'SETUP',
  'PARENT_HOME',
  'PARENT_APPROVALS',
  'PARENT_CHORES',
  'PARENT_REWARDS',
  'PARENT_FEEDBACK',
  'PARENT_FEEDBACK_DETAIL',
  'PARENT_FEEDBACK_EXPORT',
  'DASHBOARD_HOME',
  'DASHBOARD_CHORE_BOARD',
  'DASHBOARD_CHORE_DETAIL',
  'DASHBOARD_ACTIVE_CHORE',
  'DASHBOARD_FEEDBACK',
]);
export const FeedbackApiOperationSchema = z.enum([
  'GET_PARENT_SNAPSHOT',
  'GET_DASHBOARD_SNAPSHOT',
  'CREATE_HOUSEHOLD',
  'CREATE_CHILD',
  'GET_CHILD_LEDGER',
  'GET_CHILD_BALANCE',
  'RECORD_MANUAL_LEDGER_ENTRY',
  'CREATE_CHORE_TEMPLATE',
  'PUBLISH_CHORE_INSTANCE',
  'LIST_CHORE_INSTANCES',
  'CLAIM_CHORE',
  'SUBMIT_CHORE',
  'EXTEND_CHORE_CLAIM',
  'CANCEL_CHORE_CLAIM',
  'APPROVE_CHORE',
  'REJECT_CHORE',
  'CREATE_FEEDBACK',
  'LIST_FEEDBACK',
  'GET_FEEDBACK',
  'UPDATE_FEEDBACK',
  'DELETE_FEEDBACK',
  'CREATE_FEEDBACK_PUBLIC_PREVIEW',
]);
export const FeedbackConnectionStateSchema = z.enum(['ONLINE', 'OFFLINE']);
export const FeedbackDurationBucketSchema = z.enum([
  'UNDER_250_MS',
  'UNDER_1_SECOND',
  'UNDER_5_SECONDS',
  'FIVE_SECONDS_OR_MORE',
]);

export const FeedbackDiagnosticEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('SCREEN'),
      at: IsoUtcTimestampSchema,
      screen: FeedbackScreenSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('NETWORK'),
      at: IsoUtcTimestampSchema,
      state: FeedbackConnectionStateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('API_RESULT'),
      at: IsoUtcTimestampSchema,
      operation: FeedbackApiOperationSchema,
      outcome: z.enum(['SUCCESS', 'ERROR']),
      status: z.number().int().min(100).max(599).nullable(),
      errorCode: ApiErrorCodeSchema.nullable(),
      durationBucket: FeedbackDurationBucketSchema,
      requestId: z.uuid().nullable(),
    })
    .strict(),
]);

const DiagnosticEventsSchema = z
  .array(FeedbackDiagnosticEventSchema)
  .max(MAX_DIAGNOSTIC_EVENTS)
  .refine(
    (events) =>
      new TextEncoder().encode(JSON.stringify(events)).byteLength <=
      MAX_DIAGNOSTIC_BYTES,
    {
      message: `Diagnostic events must not exceed ${MAX_DIAGNOSTIC_BYTES} bytes.`,
    },
  )
  .refine(eventsFitIncidentWindow, {
    message: `Diagnostic events must fit within ${DIAGNOSTIC_WINDOW_MS} milliseconds.`,
  });
export const ClientDiagnosticSnapshotSchema = z
  .object({
    source: FeedbackSourceSchema,
    appVersion: FeedbackAppVersionSchema,
    currentScreen: FeedbackScreenSchema,
    events: DiagnosticEventsSchema,
  })
  .strict();

const FeedbackDescriptionSchema = z
  .string()
  .trim()
  .max(MAX_FEEDBACK_DESCRIPTION_LENGTH);
const FeedbackTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEEDBACK_TITLE_LENGTH);

export const CreateFeedbackCommandSchema = z
  .object({
    idempotencyKey: z.uuid(),
    category: FeedbackCategorySchema,
    description: FeedbackDescriptionSchema,
    diagnosticSnapshot: ClientDiagnosticSnapshotSchema,
  })
  .strict();
export const UpdateFeedbackCommandSchema = z
  .object({
    idempotencyKey: z.uuid(),
    expectedUpdatedAt: FeedbackRevisionSchema,
    title: FeedbackTitleSchema.optional(),
    description: FeedbackDescriptionSchema.optional(),
    diagnosticEvents: DiagnosticEventsSchema.optional(),
    status: FeedbackStatusSchema.optional(),
    publicIssueUrl: z.url().nullable().optional(),
  })
  .strict();

export const FeedbackPrivacyFindingKindSchema = z.enum([
  'KNOWN_PRIVATE_TERM',
  'EMAIL',
  'IP_ADDRESS',
  'HOSTNAME',
  'UUID',
  'CREDENTIAL',
  'LINK',
]);
export const FeedbackPrivacyFindingSchema = z
  .object({
    field: z.enum(['TITLE', 'DESCRIPTION']),
    kind: FeedbackPrivacyFindingKindSchema,
    start: z.number().int().min(0),
    end: z.number().int().min(1),
  })
  .strict()
  .refine((finding) => finding.start < finding.end, {
    message: 'Finding start must be before its end.',
    path: ['end'],
  });

const FeedbackBaseSchema = z
  .object({
    id: FeedbackIdSchema,
    category: FeedbackCategorySchema,
    source: FeedbackSourceSchema,
    appVersion: FeedbackAppVersionSchema,
    screen: FeedbackScreenSchema,
    status: FeedbackStatusSchema,
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
  })
  .strict();
export const FeedbackListItemSchema = FeedbackBaseSchema.extend({
  descriptionPreview: z.string(),
  hasDiagnostics: z.boolean(),
}).strict();
export const FeedbackSubmissionReceiptSchema = z
  .object({
    id: FeedbackIdSchema,
    status: FeedbackStatusSchema,
    createdAt: IsoUtcTimestampSchema,
  })
  .strict();
export const FeedbackReportSchema = FeedbackBaseSchema.extend({
  title: FeedbackTitleSchema,
  description: FeedbackDescriptionSchema,
  diagnosticSnapshot: ClientDiagnosticSnapshotSchema,
  privacyFindings: z.array(FeedbackPrivacyFindingSchema),
  publicIssueUrl: z.url().nullable(),
  reviewedAt: IsoUtcTimestampSchema.nullable(),
  exportedAt: IsoUtcTimestampSchema.nullable(),
  closedAt: IsoUtcTimestampSchema.nullable(),
}).strict();
export const DeleteFeedbackCommandSchema = z
  .object({ idempotencyKey: z.uuid() })
  .strict();
export const DeletedFeedbackSchema = z
  .object({ id: FeedbackIdSchema, deleted: z.literal(true) })
  .strict();

export const FeedbackPublicPreviewRequestSchema = z
  .object({
    publicTitle: FeedbackTitleSchema,
    publicDescription: FeedbackDescriptionSchema,
    includeDiagnostics: z.boolean(),
  })
  .strict();
export const FeedbackRepositoryUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.split('/').filter(Boolean).length === 2
    );
  },
  { message: 'Expected an HTTPS github.com repository URL.' },
);
export const FeedbackPublicPreviewSchema = z
  .object({
    repositoryUrl: FeedbackRepositoryUrlSchema,
    title: FeedbackTitleSchema,
    body: z.string().trim().min(1).max(6_000),
    labels: z.array(z.string().trim().min(1).max(80)).max(20),
    redactions: z
      .array(FeedbackPrivacyFindingKindSchema)
      .max(7)
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: 'Redaction kinds must be unique.',
      }),
  })
  .strict();

export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;
export type FeedbackAppVersion = z.infer<typeof FeedbackAppVersionSchema>;
export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>;
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;
export type FeedbackScreen = z.infer<typeof FeedbackScreenSchema>;
export type FeedbackApiOperation = z.infer<typeof FeedbackApiOperationSchema>;
export type FeedbackConnectionState = z.infer<
  typeof FeedbackConnectionStateSchema
>;
export type FeedbackDurationBucket = z.infer<
  typeof FeedbackDurationBucketSchema
>;
export type FeedbackDiagnosticEvent = z.infer<
  typeof FeedbackDiagnosticEventSchema
>;
export type ClientDiagnosticSnapshot = z.infer<
  typeof ClientDiagnosticSnapshotSchema
>;
export type CreateFeedbackCommand = z.infer<typeof CreateFeedbackCommandSchema>;
export type UpdateFeedbackCommand = z.infer<typeof UpdateFeedbackCommandSchema>;
export type FeedbackPrivacyFindingKind = z.infer<
  typeof FeedbackPrivacyFindingKindSchema
>;
export type FeedbackPrivacyFinding = z.infer<
  typeof FeedbackPrivacyFindingSchema
>;
export type FeedbackListItem = z.infer<typeof FeedbackListItemSchema>;
export type FeedbackSubmissionReceipt = z.infer<
  typeof FeedbackSubmissionReceiptSchema
>;
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>;
export type DeleteFeedbackCommand = z.infer<typeof DeleteFeedbackCommandSchema>;
export type DeletedFeedback = z.infer<typeof DeletedFeedbackSchema>;
export type FeedbackPublicPreviewRequest = z.infer<
  typeof FeedbackPublicPreviewRequestSchema
>;
export type FeedbackPublicPreview = z.infer<typeof FeedbackPublicPreviewSchema>;

function eventsFitIncidentWindow(
  events: readonly z.infer<typeof FeedbackDiagnosticEventSchema>[],
): boolean {
  if (events.length < 2) return true;
  let earliest: ExactTimestamp | undefined;
  let latest: ExactTimestamp | undefined;
  for (const event of events) {
    const timestamp = exactTimestamp(event.at);
    if (!timestamp) return false;
    if (!earliest || compareExactTimestamp(timestamp, earliest) < 0) {
      earliest = timestamp;
    }
    if (!latest || compareExactTimestamp(timestamp, latest) > 0) {
      latest = timestamp;
    }
  }
  const seconds = latest!.seconds - earliest!.seconds;
  if (seconds < BigInt(DIAGNOSTIC_WINDOW_MS / 1_000)) return true;
  if (seconds > BigInt(DIAGNOSTIC_WINDOW_MS / 1_000)) return false;
  return compareFractions(latest!.fraction, earliest!.fraction) <= 0;
}

interface ExactTimestamp {
  seconds: bigint;
  fraction: string;
}

function exactTimestamp(value: string): ExactTimestamp | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z$/.exec(
      value,
    );
  if (!match) return undefined;
  const year = BigInt(match[1]!);
  const month = Number(match[2]);
  const day = BigInt(match[3]!);
  const hour = BigInt(match[4]!);
  const minute = BigInt(match[5]!);
  const second = BigInt(match[6] ?? 0);
  const completedYears =
    365n * year + (year + 3n) / 4n - (year + 99n) / 100n + (year + 399n) / 400n;
  const completedMonths = [
    0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
  ][month - 1]!;
  const leapDay =
    month > 2 &&
    (year % 400n === 0n || (year % 4n === 0n && year % 100n !== 0n))
      ? 1n
      : 0n;
  return {
    seconds:
      (completedYears + BigInt(completedMonths) + leapDay + day - 1n) *
        86_400n +
      hour * 3_600n +
      minute * 60n +
      second,
    fraction: (match[7] ?? '').replace(/0+$/u, ''),
  };
}

function compareExactTimestamp(
  left: ExactTimestamp,
  right: ExactTimestamp,
): number {
  if (left.seconds < right.seconds) return -1;
  if (left.seconds > right.seconds) return 1;
  return compareFractions(left.fraction, right.fraction);
}

function compareFractions(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left.charCodeAt(index) || 48;
    const rightDigit = right.charCodeAt(index) || 48;
    if (leftDigit < rightDigit) return -1;
    if (leftDigit > rightDigit) return 1;
  }
  return 0;
}
