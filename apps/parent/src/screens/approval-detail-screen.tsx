import {
  FamilyApiError,
  createSecureUuid,
  formatCents,
  type ClientSession,
} from '@family/api-client';
import type { ChoreDecisionResult } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyInput } from '../components/money-input';
import {
  type ApprovalDraft,
  useApprovalOperation,
} from '../features/approvals/use-approval-operation';
import { parentSnapshotQueryOptions } from '../query/parent-snapshot';
import { ScreenState } from '../components/screen-state';
import { ScreenStateAction } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';

type DraftState = {
  draft: ApprovalDraft;
  idempotencyKey: string;
};

type DecisionKind = 'approve' | 'retry' | 'close';

export function ApprovalDetailScreen({
  submissionAttemptId,
  session,
  fetch: fetchImpl,
  onReportProblem,
}: {
  submissionAttemptId: string;
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const snapshotQuery = useQuery(
    parentSnapshotQueryOptions(session, fetchImpl),
  );
  const pending = snapshotQuery.data?.pendingApprovals.find(
    (candidate) => candidate.submissionAttemptId === submissionAttemptId,
  );
  const [draftState, setDraftState] = useState<DraftState>();
  const [result, setResult] = useState<ChoreDecisionResult>();
  const [error, setError] = useState<string>();
  const [reportableError, setReportableError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decisionKind, setDecisionKind] = useState<DecisionKind>();
  const decisionGeneration = useRef(0);

  useEffect(() => {
    if (!pending) return;
    setDraftState((current) =>
      current?.draft.submissionAttemptId === pending.submissionAttemptId
        ? current
        : {
            draft: {
              submissionAttemptId: pending.submissionAttemptId,
              choreInstanceId: pending.chore.id,
              payoutInput: (pending.chore.valueCents / 100).toFixed(2),
              note: '',
              rejectionReason: '',
            },
            idempotencyKey: createSecureUuid(),
          },
    );
  }, [pending]);

  const operation = useApprovalOperation({
    session,
    fetch: fetchImpl,
    idempotencyKey:
      draftState?.idempotencyKey ?? '00000000-0000-4000-8000-000000000000',
  });
  const latestOperation = useRef(operation);
  latestOperation.current = operation;
  useEffect(
    () => () => {
      decisionGeneration.current += 1;
      latestOperation.current.cancel();
    },
    [],
  );

  if (!snapshotQuery.data && snapshotQuery.isPending) {
    return <ScreenState message="Loading chore…" />;
  }
  if (!snapshotQuery.data) {
    return (
      <ScreenState
        message="This chore could not be loaded."
        primaryActionLabel="Try again"
        onPrimaryAction={() => void snapshotQuery.refetch()}
        actionLabel={onReportProblem ? 'Report this problem' : undefined}
        onAction={
          onReportProblem
            ? () =>
                onReportProblem({
                  category: 'BROKEN',
                  screen: 'PARENT_APPROVALS',
                })
            : undefined
        }
      />
    );
  }
  if (result) return <DecisionResult result={result} />;
  if (!pending || !draftState) {
    return (
      <ScreenState message="This submission is no longer awaiting approval." />
    );
  }

  const draft = draftState.draft;
  const changeDraft = (change: Partial<ApprovalDraft>) => {
    setDraftState((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...change } }
        : current,
    );
  };
  const decide = async (
    kind: DecisionKind,
    action: (draft: ApprovalDraft) => Promise<ChoreDecisionResult>,
  ) => {
    if (decisionKind !== undefined && decisionKind !== kind) return;
    setDecisionKind(kind);
    setError(undefined);
    setReportableError(false);
    setSubmitting(true);
    const generation = decisionGeneration.current;
    await settleApprovalDecision({
      action: () => action(draft),
      isCurrent: () => generation === decisionGeneration.current,
      onResult: setResult,
      onError: (caught) => {
        if (
          caught instanceof RangeError ||
          (caught instanceof FamilyApiError && caught.kind === 'VALIDATION')
        ) {
          setDecisionKind(undefined);
        }
        setError(decisionErrorMessage(caught));
        setReportableError(isReportableDecisionError(caught));
      },
      onSettled: () => setSubmitting(false),
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{pending.child.name.toUpperCase()}</Text>
      <Text style={styles.title}>{pending.chore.name}</Text>
      <Text style={styles.instructions}>{pending.chore.instructions}</Text>

      <MoneyInput
        value={draft.payoutInput}
        onChangeText={(payoutInput) => changeDraft({ payoutInput })}
        editable={!submitting && decisionKind === undefined}
      />
      <Text style={styles.label}>Approval note</Text>
      <TextInput
        accessibilityLabel="Approval note"
        editable={!submitting && decisionKind === undefined}
        multiline
        onChangeText={(note) => changeDraft({ note })}
        placeholder="Optional encouragement"
        style={styles.textArea}
        value={draft.note}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Approve chore"
        disabled={
          submitting ||
          (decisionKind !== undefined && decisionKind !== 'approve')
        }
        onPress={() => void decide('approve', operation.approve)}
        style={[styles.button, styles.approveButton]}
      >
        <Text style={styles.primaryButtonText}>Approve chore</Text>
      </Pressable>

      <View style={styles.divider} />
      <Text style={styles.label}>Rejection reason</Text>
      <TextInput
        accessibilityLabel="Rejection reason"
        editable={!submitting && decisionKind === undefined}
        multiline
        onChangeText={(rejectionReason) => changeDraft({ rejectionReason })}
        placeholder="Optional reason"
        style={styles.textArea}
        value={draft.rejectionReason}
      />
      <View style={styles.rejectionActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try this chore again"
          disabled={
            submitting ||
            (decisionKind !== undefined && decisionKind !== 'retry')
          }
          onPress={() =>
            void decide('retry', (nextDraft) =>
              operation.reject(nextDraft, true),
            )
          }
          style={[styles.button, styles.retryButton]}
        >
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close this chore"
          disabled={
            submitting ||
            (decisionKind !== undefined && decisionKind !== 'close')
          }
          onPress={() =>
            void decide('close', (nextDraft) =>
              operation.reject(nextDraft, false),
            )
          }
          style={[styles.button, styles.closeButton]}
        >
          <Text style={styles.closeButtonText}>Close chore</Text>
        </Pressable>
      </View>
      {submitting ? (
        <ActivityIndicator
          accessibilityLabel="Saving decision"
          color={familyTokens.color.focus}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {error && reportableError && onReportProblem ? (
        <ScreenStateAction
          label="Report this problem"
          onPress={() =>
            onReportProblem({
              category: 'BROKEN',
              screen: 'PARENT_APPROVALS',
            })
          }
        />
      ) : null}
    </ScrollView>
  );
}

export async function settleApprovalDecision({
  action,
  isCurrent,
  onResult,
  onError,
  onSettled,
}: {
  action: () => Promise<ChoreDecisionResult>;
  isCurrent: () => boolean;
  onResult: (result: ChoreDecisionResult) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}): Promise<void> {
  try {
    const result = await action();
    if (isCurrent()) onResult(result);
  } catch (caught) {
    if (isCurrent()) onError(caught);
  } finally {
    if (isCurrent()) onSettled();
  }
}

function DecisionResult({ result }: { result: ChoreDecisionResult }) {
  return (
    <View style={styles.result}>
      <Text style={styles.resultSymbol}>
        {result.decision === 'APPROVED' ? '✓' : '↩'}
      </Text>
      <Text style={styles.resultTitle}>
        {result.decision === 'APPROVED'
          ? `Approved ${formatCents(result.payoutCents ?? 0, 'en-US')}`
          : 'Chore rejected'}
      </Text>
      {result.note ? (
        <Text style={styles.resultNote}>{result.note}</Text>
      ) : null}
    </View>
  );
}

function decisionErrorMessage(error: unknown): string {
  if (error instanceof RangeError) {
    return 'Enter dollars with no more than two decimals.';
  }
  if (error instanceof Error) return error.message;
  return 'The decision could not be saved.';
}

function isReportableDecisionError(error: unknown): boolean {
  return !(
    error instanceof RangeError ||
    (error instanceof FamilyApiError && error.kind === 'VALIDATION')
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
  },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: familyTokens.color.ink,
    fontSize: 30,
    fontWeight: '800',
  },
  instructions: { color: familyTokens.color.mutedInk, fontSize: 16 },
  label: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  textArea: {
    minHeight: 76,
    padding: familyTokens.space.md,
    borderWidth: 1,
    borderColor: '#C7CED1',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
    color: familyTokens.color.ink,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
  },
  approveButton: { backgroundColor: familyTokens.color.success },
  retryButton: { flex: 1, backgroundColor: '#E8F0FE' },
  closeButton: { flex: 1, backgroundColor: '#F9E1E1' },
  primaryButtonText: {
    color: familyTokens.color.surface,
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: familyTokens.color.focus,
    fontSize: 16,
    fontWeight: '800',
  },
  closeButtonText: {
    color: familyTokens.color.danger,
    fontSize: 16,
    fontWeight: '800',
  },
  divider: { height: 1, backgroundColor: '#DDE2E4' },
  rejectionActions: { flexDirection: 'row', gap: familyTokens.space.sm },
  error: { color: familyTokens.color.danger, fontSize: 15, fontWeight: '700' },
  result: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.xl,
    backgroundColor: familyTokens.color.canvas,
  },
  resultSymbol: { color: familyTokens.color.success, fontSize: 64 },
  resultTitle: {
    color: familyTokens.color.ink,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  resultNote: {
    color: familyTokens.color.mutedInk,
    fontSize: 17,
    textAlign: 'center',
  },
});
