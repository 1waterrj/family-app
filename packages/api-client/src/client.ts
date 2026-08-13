import {
  ChoreDecisionResultSchema,
  ChoreInstanceSchema,
  ChoreSubmissionResultSchema,
  ChoreTemplateSchema,
  CreateFeedbackCommandSchema,
  DashboardSnapshotSchema,
  DeleteFeedbackCommandSchema,
  DeletedFeedbackSchema,
  FeedbackIdSchema,
  FeedbackListItemSchema,
  FeedbackPublicPreviewRequestSchema,
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  FeedbackSubmissionReceiptSchema,
  LedgerSummarySchema,
  LedgerTransactionSchema,
  ParentSnapshotSchema,
  UpdateFeedbackCommandSchema,
  type ApproveChore,
  type ChoreDecisionResult,
  type ChoreInstance,
  type ChoreSubmissionResult,
  type ChoreTemplate,
  type ClaimChore,
  type CreateFeedbackCommand,
  type CreateChoreTemplate,
  type DashboardSnapshot,
  type DeleteFeedbackCommand,
  type DeletedFeedback,
  type FeedbackListItem,
  type FeedbackPublicPreview,
  type FeedbackPublicPreviewRequest,
  type FeedbackReport,
  type FeedbackSubmissionReceipt,
  type LedgerSummary,
  type LedgerTransaction,
  type ManualLedgerEntry,
  type ParentSnapshot,
  type PublishChoreInstance,
  type RejectChore,
  type SubmitChore,
  type UpdateFeedbackCommand,
} from '@family/contracts';
import { z } from 'zod';

import { FamilyApiError, toFamilyApiError } from './errors.js';

export type FamilyApiClientOptions = {
  apiOrigin: string;
  accessToken: string;
  fetch: typeof globalThis.fetch;
  requestTimeoutMs?: number;
};

export type FeedbackListQuery = Record<string, never>;

export interface FamilyApiClient {
  cancelPendingRequests(): void;
  getParentSnapshot(): Promise<ParentSnapshot>;
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  createTemplate(input: CreateChoreTemplate): Promise<ChoreTemplate>;
  publishChore(input: PublishChoreInstance): Promise<ChoreInstance>;
  claimChore(input: ClaimChore): Promise<ChoreInstance>;
  submitChore(input: SubmitChore): Promise<ChoreSubmissionResult>;
  approveChore(input: ApproveChore): Promise<ChoreDecisionResult>;
  rejectChore(input: RejectChore): Promise<ChoreDecisionResult>;
  getLedger(childId: string): Promise<LedgerSummary>;
  recordLedgerEntry(input: ManualLedgerEntry): Promise<LedgerTransaction>;
  createFeedback(
    input: CreateFeedbackCommand,
  ): Promise<FeedbackSubmissionReceipt>;
  listFeedback(query?: FeedbackListQuery): Promise<FeedbackListItem[]>;
  getFeedback(feedbackId: string): Promise<FeedbackReport>;
  updateFeedback(
    feedbackId: string,
    input: UpdateFeedbackCommand,
  ): Promise<FeedbackReport>;
  deleteFeedback(
    feedbackId: string,
    input: DeleteFeedbackCommand,
  ): Promise<DeletedFeedback>;
  prepareFeedbackPublicPreview(
    feedbackId: string,
    input: FeedbackPublicPreviewRequest,
  ): Promise<FeedbackPublicPreview>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type ClientSession = {
  apiOrigin: string;
  accessToken: string;
  actorId: string;
  householdId: string;
  role: 'PARENT' | 'DASHBOARD';
};

export function createFamilyApiClient(
  options: FamilyApiClientOptions,
): FamilyApiClient {
  const apiOrigin = new URL(options.apiOrigin).toString();
  const fetchImpl = options.fetch;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('requestTimeoutMs must be a positive finite number.');
  }
  const feedbackListQuerySchema = z.object({}).strict();
  const pendingRequests = new Set<{
    controller: AbortController;
    reject(error: unknown): void;
  }>();

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    let rejectCancellation!: (error: unknown) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const pending = { controller, reject: rejectCancellation };
    pendingRequests.add(pending);
    const timeout = setTimeout(() => {
      const error = FamilyApiError.offline();
      pending.reject(error);
      controller.abort(error);
    }, requestTimeoutMs);

    try {
      return await Promise.race([
        performRequest(path, schema, { ...init, signal: controller.signal }),
        cancellation,
      ]);
    } finally {
      clearTimeout(timeout);
      pendingRequests.delete(pending);
    }
  }

  async function performRequest<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, apiOrigin), {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.accessToken}`,
          ...init.headers,
        },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw FamilyApiError.offline();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!response.ok) throw toFamilyApiError(response.status, undefined);
      throw FamilyApiError.malformedResponse();
    }
    if (!response.ok) throw toFamilyApiError(response.status, payload);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw FamilyApiError.malformedResponse();
    return parsed.data;
  }

  function mutation<T>(
    path: string,
    schema: z.ZodType<T>,
    input: { idempotencyKey: string },
    body: Record<string, unknown>,
    method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
  ): Promise<T> {
    return request(path, schema, {
      method,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  }

  return {
    cancelPendingRequests() {
      for (const pending of pendingRequests) {
        const error = abortError();
        pending.reject(error);
        pending.controller.abort(error);
      }
    },
    getParentSnapshot: () =>
      request('/v1/parent/snapshot', ParentSnapshotSchema),
    getDashboardSnapshot: () =>
      request('/v1/dashboard/snapshot', DashboardSnapshotSchema),
    createTemplate: (input) => {
      const { idempotencyKey, ...body } = input;
      return mutation(
        '/v1/chore-templates',
        ChoreTemplateSchema,
        { idempotencyKey },
        body,
      );
    },
    publishChore: (input) => {
      const { idempotencyKey, ...body } = input;
      return mutation(
        '/v1/chore-instances',
        ChoreInstanceSchema,
        { idempotencyKey },
        body,
      );
    },
    claimChore: (input) => {
      const { choreInstanceId, idempotencyKey, ...body } = input;
      return mutation(
        `/v1/chore-instances/${choreInstanceId}/claim`,
        ChoreInstanceSchema,
        { idempotencyKey },
        body,
      );
    },
    submitChore: (input) => {
      const { choreInstanceId, idempotencyKey, ...body } = input;
      return mutation(
        `/v1/chore-instances/${choreInstanceId}/submit`,
        ChoreSubmissionResultSchema,
        { idempotencyKey },
        body,
      );
    },
    approveChore: (input) => {
      const { choreInstanceId, idempotencyKey, ...body } = input;
      return mutation(
        `/v1/chore-instances/${choreInstanceId}/approve`,
        ChoreDecisionResultSchema,
        { idempotencyKey },
        body,
      );
    },
    rejectChore: (input) => {
      const { choreInstanceId, idempotencyKey, ...body } = input;
      return mutation(
        `/v1/chore-instances/${choreInstanceId}/reject`,
        ChoreDecisionResultSchema,
        { idempotencyKey },
        body,
      );
    },
    getLedger: (childId) =>
      request(`/v1/children/${childId}/ledger`, LedgerSummarySchema),
    recordLedgerEntry: (input) => {
      const { childId, idempotencyKey, ...body } = input;
      return mutation(
        `/v1/children/${childId}/ledger`,
        LedgerTransactionSchema,
        { idempotencyKey },
        body,
      );
    },
    createFeedback: async (input) => {
      const { idempotencyKey, ...body } =
        CreateFeedbackCommandSchema.parse(input);
      return mutation(
        '/v1/feedback',
        FeedbackSubmissionReceiptSchema,
        { idempotencyKey },
        body,
      );
    },
    listFeedback: async (query = {}) => {
      const parsedQuery = feedbackListQuerySchema.parse(query);
      const search = new URLSearchParams(parsedQuery).toString();
      const path = search === '' ? '/v1/feedback' : `/v1/feedback?${search}`;
      return request(path, FeedbackListItemSchema.array());
    },
    getFeedback: async (feedbackId) =>
      request(feedbackPath(feedbackId), FeedbackReportSchema),
    updateFeedback: async (feedbackId, input) => {
      const { idempotencyKey, ...body } =
        UpdateFeedbackCommandSchema.parse(input);
      return mutation(
        feedbackPath(feedbackId),
        FeedbackReportSchema,
        { idempotencyKey },
        body,
        'PATCH',
      );
    },
    deleteFeedback: async (feedbackId, input) => {
      const parsed = DeleteFeedbackCommandSchema.parse(input);
      return mutation(
        feedbackPath(feedbackId),
        DeletedFeedbackSchema,
        parsed,
        {},
        'DELETE',
      );
    },
    prepareFeedbackPublicPreview: async (feedbackId, input) => {
      const parsed = FeedbackPublicPreviewRequestSchema.parse(input);
      return request(
        feedbackPath(feedbackId, '/public-preview'),
        FeedbackPublicPreviewSchema,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed),
        },
      );
    },
  };
}

function feedbackPath(feedbackId: string, suffix = ''): string {
  const parsedId = FeedbackIdSchema.parse(feedbackId);
  return `/v1/feedback/${parsedId}${suffix}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function abortError(): Error {
  const error = new Error('The API request was cancelled.');
  error.name = 'AbortError';
  return error;
}
