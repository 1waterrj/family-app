import {
  createFamilyApiClient,
  createSecureUuid,
  familyQueryKeys,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import { normalizeLocalDevelopmentOrigin } from '@family/contracts';
import {
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';

export type FeedbackSubmissionClient = Pick<FamilyApiClient, 'createFeedback'> &
  Partial<Pick<FamilyApiClient, 'cancelPendingRequests'>>;
export type FeedbackListClient = Pick<FamilyApiClient, 'listFeedback'>;
export type FeedbackDetailClient = Pick<FamilyApiClient, 'getFeedback'>;
export type FeedbackUpdateClient = Pick<FamilyApiClient, 'updateFeedback'>;
export type FeedbackDeleteClient = Pick<FamilyApiClient, 'deleteFeedback'>;
export type FeedbackPreviewClient = Pick<
  FamilyApiClient,
  'prepareFeedbackPublicPreview'
>;

export function parentFeedbackScope(session: ClientSession): string {
  const apiOrigin = normalizeLocalDevelopmentOrigin(session.apiOrigin);
  if (!apiOrigin)
    throw new Error('Parent feedback requires a local API origin.');

  return JSON.stringify([
    apiOrigin,
    session.householdId,
    session.actorId,
    session.role,
  ]);
}

export function createParentFeedbackClient(
  session: ClientSession,
  fetch: typeof globalThis.fetch,
): FeedbackSubmissionClient {
  const client = createFamilyApiClient({
    apiOrigin: session.apiOrigin,
    accessToken: session.accessToken,
    fetch,
  });
  return {
    createFeedback: client.createFeedback,
    cancelPendingRequests: client.cancelPendingRequests,
  };
}

export function feedbackListQueryOptions(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
  providedClient?: FeedbackListClient,
) {
  const client = providedClient ?? feedbackListClient(session, fetchImpl);
  return queryOptions({
    queryKey: familyQueryKeys.feedbackList(session),
    queryFn: () => client.listFeedback(),
  });
}

export function feedbackDetailQueryOptions(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
  feedbackId: string,
  providedClient?: FeedbackDetailClient,
) {
  const client = providedClient ?? feedbackDetailClient(session, fetchImpl);
  return queryOptions({
    queryKey: familyQueryKeys.feedbackDetail(session, feedbackId),
    queryFn: () => client.getFeedback(feedbackId),
    gcTime: 0,
  });
}

export function createFeedbackPreviewClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FeedbackPreviewClient {
  const { prepareFeedbackPublicPreview } = createClient(session, fetchImpl);
  return { prepareFeedbackPublicPreview };
}

export function feedbackCreateMutationOptions({
  session,
  fetch: fetchImpl,
  queryClient,
  client: providedClient,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  queryClient: QueryClient;
  client?: FeedbackSubmissionClient;
}) {
  const client =
    providedClient ?? createParentFeedbackClient(session, fetchImpl);
  return mutationOptions({
    mutationFn: client.createFeedback,
    onSuccess: async (receipt) => {
      await invalidateFeedbackReads(queryClient, session, receipt.id);
    },
  });
}

export function feedbackUpdateMutationOptions({
  session,
  fetch: fetchImpl,
  feedbackId,
  queryClient,
  client: providedClient,
  onCanonicalReport,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  feedbackId: string;
  queryClient: QueryClient;
  client?: FeedbackUpdateClient;
  onCanonicalReport?: (
    report: Awaited<ReturnType<FamilyApiClient['updateFeedback']>>,
  ) => void;
}) {
  const client = providedClient ?? feedbackUpdateClient(session, fetchImpl);
  return mutationOptions({
    mutationFn: (input: Parameters<FamilyApiClient['updateFeedback']>[1]) =>
      client.updateFeedback(feedbackId, input),
    onSuccess: async (report) => {
      onCanonicalReport?.(report);
      queryClient.setQueriesData(
        {
          queryKey: familyQueryKeys.feedbackDetail(session, feedbackId),
          exact: true,
        },
        report,
      );
      await invalidateFeedbackReads(queryClient, session, feedbackId);
    },
  });
}

export function feedbackDeleteMutationOptions({
  session,
  fetch: fetchImpl,
  feedbackId,
  queryClient,
  client: providedClient,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  feedbackId: string;
  queryClient: QueryClient;
  client?: FeedbackDeleteClient;
}) {
  const client = providedClient ?? feedbackDeleteClient(session, fetchImpl);
  const detailQueryKey = familyQueryKeys.feedbackDetail(session, feedbackId);
  return mutationOptions({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: detailQueryKey,
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: detailQueryKey,
        exact: true,
        refetchType: 'none',
      });
    },
    mutationFn: (input: Parameters<FamilyApiClient['deleteFeedback']>[1]) =>
      client.deleteFeedback(feedbackId, input),
    onSuccess: async () => {
      await queryClient.cancelQueries({
        queryKey: detailQueryKey,
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: detailQueryKey,
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: familyQueryKeys.feedbackList(session),
      });
    },
  });
}

export function createFeedbackOperationUuid(): string {
  return createSecureUuid();
}

function createClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FamilyApiClient {
  return createFamilyApiClient({
    apiOrigin: session.apiOrigin,
    accessToken: session.accessToken,
    fetch: fetchImpl,
  });
}

function feedbackListClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FeedbackListClient {
  const { listFeedback } = createClient(session, fetchImpl);
  return { listFeedback };
}

function feedbackDetailClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FeedbackDetailClient {
  const { getFeedback } = createClient(session, fetchImpl);
  return { getFeedback };
}

function feedbackUpdateClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FeedbackUpdateClient {
  const { updateFeedback } = createClient(session, fetchImpl);
  return { updateFeedback };
}

function feedbackDeleteClient(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
): FeedbackDeleteClient {
  const { deleteFeedback } = createClient(session, fetchImpl);
  return { deleteFeedback };
}

function invalidateFeedbackReads(
  queryClient: QueryClient,
  session: ClientSession,
  feedbackId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: familyQueryKeys.feedbackList(session),
    }),
    queryClient.invalidateQueries({
      queryKey: familyQueryKeys.feedbackDetail(session, feedbackId),
    }),
  ]).then(() => undefined);
}
