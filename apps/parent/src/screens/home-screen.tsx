import type { ClientSession } from '@family/api-client';
import { familyTokens } from '@family/design-tokens';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ChildSummaryCard } from '../components/child-summary-card';
import {
  ConnectionStatus,
  useOnlineStatus,
} from '../components/connection-status';
import { ScreenState } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';
import { parentSnapshotQueryOptions } from '../query/parent-snapshot';

export function HomeScreen({
  session,
  fetch: fetchImpl,
  isOnline: isOnlineOverride,
  onOpenApprovals = () => undefined,
  onReportProblem,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  isOnline?: boolean;
  onOpenApprovals?: () => void;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const observedOnline = useOnlineStatus();
  const isOnline = isOnlineOverride ?? observedOnline;
  const snapshotQuery = useQuery(
    parentSnapshotQueryOptions(session, fetchImpl),
  );

  if (!snapshotQuery.data && snapshotQuery.isPending) {
    return <ScreenState message="Loading your family…" />;
  }
  if (!snapshotQuery.data) {
    return (
      <ScreenState
        message={
          isOnline
            ? 'Family data could not be loaded. Pull down to try again.'
            : 'Connect to your family server to load this device.'
        }
        primaryActionLabel="Try again"
        onPrimaryAction={() => void snapshotQuery.refetch()}
        actionLabel={onReportProblem ? 'Report this problem' : undefined}
        onAction={
          onReportProblem
            ? () =>
                onReportProblem({
                  category: 'BROKEN',
                  screen: 'PARENT_HOME',
                })
            : undefined
        }
      />
    );
  }

  const snapshot = snapshotQuery.data;
  const pendingCount = snapshot.pendingApprovals.length;

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
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>TODAY AT HOME</Text>
          <Text style={styles.title}>{snapshot.household.name}</Text>
        </View>
        <View style={styles.approvalBadge}>
          <Text style={styles.approvalCount}>{pendingCount}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review ${pendingCount} pending ${pendingCount === 1 ? 'approval' : 'approvals'}`}
        onPress={onOpenApprovals}
        style={({ pressed }) => [
          styles.approvalLink,
          pressed && styles.approvalLinkPressed,
        ]}
      >
        <Text style={styles.approvalLabel}>
          {pendingCount === 1
            ? '1 chore awaiting approval'
            : `${pendingCount} chores awaiting approval`}
        </Text>
        <Text accessibilityElementsHidden style={styles.approvalChevron}>
          ›
        </Text>
      </Pressable>
      <ConnectionStatus
        isOnline={isOnline}
        isRefreshing={snapshotQuery.isRefetching}
        isStale={snapshotQuery.isStale}
        hasData
      />
      <View style={styles.children}>
        {snapshot.children.map((child) => {
          const activeChore = snapshot.chores.find(
            (chore) =>
              chore.claimedChildId === child.profile.id &&
              (chore.status === 'CLAIMED' ||
                chore.status === 'AWAITING_APPROVAL'),
          );
          return (
            <ChildSummaryCard
              key={child.profile.id}
              child={child}
              activeChore={activeChore}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: familyTokens.color.ink,
    fontSize: 32,
    fontWeight: '800',
  },
  approvalBadge: {
    minWidth: familyTokens.touch.phoneMinimum,
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.pill,
    backgroundColor: '#F4E6C8',
  },
  approvalCount: {
    color: familyTokens.color.warning,
    fontSize: 20,
    fontWeight: '800',
  },
  approvalLabel: {
    color: familyTokens.color.ink,
    fontSize: 17,
    fontWeight: '600',
  },
  approvalLink: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  approvalLinkPressed: { opacity: 0.72 },
  approvalChevron: { color: familyTokens.color.focus, fontSize: 28 },
  children: { gap: familyTokens.space.md },
});
