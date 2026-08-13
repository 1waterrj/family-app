import { familyQueryKeys, type ClientSession } from '@family/api-client';
import { familyTokens } from '@family/design-tokens';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  type AppStateStatus,
} from 'react-native';

import { ApprovalCard } from '../components/approval-card';
import { ScreenState } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';
import { parentSnapshotQueryOptions } from '../query/parent-snapshot';

type AppStateAdapter = {
  readonly currentState: AppStateStatus;
  addEventListener(
    event: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
};

export function ApprovalsScreen({
  session,
  fetch: fetchImpl,
  onReview,
  onReportProblem,
  appState = AppState,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  onReview(submissionAttemptId: string): void;
  onReportProblem?: OpenFeedbackDraft;
  appState?: AppStateAdapter;
}) {
  const queryClient = useQueryClient();
  const [appStateStatus, setAppStateStatus] = useState(appState.currentState);
  const previousAppState = useRef(appState.currentState);
  const queryKey = useMemo(
    () => familyQueryKeys.parentSnapshot(session),
    [session.actorId, session.apiOrigin, session.householdId, session.role],
  );
  const snapshotQuery = useQuery({
    ...parentSnapshotQueryOptions(session, fetchImpl),
    refetchInterval: (query) =>
      appStateStatus === 'active' &&
      (query.state.data?.pendingApprovals.length ?? 0) > 0
        ? 15_000
        : false,
  });

  useEffect(() => {
    const subscription = appState.addEventListener('change', (nextState) => {
      const returnedToForeground =
        previousAppState.current !== 'active' && nextState === 'active';
      previousAppState.current = nextState;
      setAppStateStatus(nextState);
      if (returnedToForeground) {
        void queryClient.invalidateQueries({ queryKey });
      }
    });
    return () => subscription.remove();
  }, [appState, queryClient, queryKey]);

  if (!snapshotQuery.data && snapshotQuery.isPending) {
    return <ScreenState message="Loading approvals…" />;
  }
  if (!snapshotQuery.data) {
    return (
      <ScreenState
        message="Approval inbox could not be loaded."
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

  const snapshot = snapshotQuery.data;
  const pending = [...snapshot.pendingApprovals].sort(
    (left, right) =>
      Date.parse(left.submittedAt) - Date.parse(right.submittedAt) ||
      left.submissionAttemptId.localeCompare(right.submissionAttemptId),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={snapshotQuery.isRefetching}
          onRefresh={() => void snapshotQuery.refetch()}
          tintColor={familyTokens.color.focus}
        />
      }
    >
      <Text style={styles.eyebrow}>PARENT INBOX</Text>
      <Text style={styles.title}>Chores to review</Text>
      <Text style={styles.summary}>
        {pending.length === 1
          ? '1 chore is ready for you.'
          : `${pending.length} chores are ready for you.`}
      </Text>
      {pending.length === 0 ? (
        <Text style={styles.empty}>All caught up.</Text>
      ) : (
        pending.map((approval) => (
          <ApprovalCard
            key={approval.submissionAttemptId}
            approval={approval}
            timeZone={snapshot.household.timeZone}
            onReview={onReview}
          />
        ))
      )}
    </ScrollView>
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
  summary: { color: familyTokens.color.mutedInk, fontSize: 16 },
  empty: {
    padding: familyTokens.space.xl,
    color: familyTokens.color.success,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
});
