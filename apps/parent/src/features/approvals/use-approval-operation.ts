import {
  createFamilyApiClient,
  familyQueryKeys,
  parseUnsignedDollars,
  type ClientSession,
} from '@family/api-client';
import {
  ChoreInstanceIdSchema,
  SubmissionAttemptIdSchema,
  type ChoreDecisionResult,
  type ParentSnapshot,
} from '@family/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

export type ApprovalDraft = {
  submissionAttemptId: string;
  choreInstanceId: string;
  payoutInput: string;
  note: string;
  rejectionReason: string;
};

export interface ApprovalOperation {
  approve(draft: ApprovalDraft): Promise<ChoreDecisionResult>;
  reject(draft: ApprovalDraft, retry: boolean): Promise<ChoreDecisionResult>;
  cancel(): void;
}

export function useApprovalOperation({
  session,
  fetch: fetchImpl,
  idempotencyKey,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  idempotencyKey: string;
}): ApprovalOperation {
  const queryClient = useQueryClient();
  const operationGeneration = useRef(0);
  const client = useMemo(
    () =>
      createFamilyApiClient({
        apiOrigin: session.apiOrigin,
        accessToken: session.accessToken,
        fetch: fetchImpl,
      }),
    [fetchImpl, session.accessToken, session.apiOrigin],
  );

  const settle = useCallback(
    async (
      operation: () => Promise<ChoreDecisionResult>,
      submissionAttemptId: string,
    ) => {
      const generation = operationGeneration.current;
      const result = await operation();
      if (generation !== operationGeneration.current) return result;

      const snapshot = queryClient.getQueryData<ParentSnapshot>(
        familyQueryKeys.parentSnapshot(session),
      );
      const childId = snapshot?.pendingApprovals.find(
        (pending) => pending.submissionAttemptId === submissionAttemptId,
      )?.child.id;
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: familyQueryKeys.parentSnapshot(session),
        }),
        childId
          ? queryClient.invalidateQueries({
              queryKey: familyQueryKeys.ledger(session, childId),
            })
          : Promise.resolve(),
      ]).catch(() => undefined);
      return result;
    },
    [queryClient, session],
  );

  return {
    approve: (draft) =>
      settle(
        () =>
          client.approveChore({
            choreInstanceId: ChoreInstanceIdSchema.parse(draft.choreInstanceId),
            submissionAttemptId: SubmissionAttemptIdSchema.parse(
              draft.submissionAttemptId,
            ),
            idempotencyKey,
            payoutCents: parseUnsignedDollars(draft.payoutInput),
            note: optionalText(draft.note),
          }),
        draft.submissionAttemptId,
      ),
    reject: (draft, retry) =>
      settle(
        () =>
          client.rejectChore({
            choreInstanceId: ChoreInstanceIdSchema.parse(draft.choreInstanceId),
            submissionAttemptId: SubmissionAttemptIdSchema.parse(
              draft.submissionAttemptId,
            ),
            idempotencyKey,
            retry,
            reason: optionalText(draft.rejectionReason),
          }),
        draft.submissionAttemptId,
      ),
    cancel: () => {
      operationGeneration.current += 1;
    },
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
