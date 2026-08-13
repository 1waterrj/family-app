import type { ClientSession, FamilyApiClient } from '@family/api-client';
import type {
  FeedbackCategory,
  FeedbackListItem,
  FeedbackSource,
  FeedbackStatus,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { feedbackListQueryOptions } from '../features/feedback/feedback-queries';

export function FeedbackInboxScreen({
  session,
  fetch: fetchImpl,
  client,
  onOpen,
  header,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  client?: Pick<FamilyApiClient, 'listFeedback'>;
  onOpen(feedbackId: string): void;
  header?: ReactNode;
}) {
  const feedbackQuery = useQuery(
    feedbackListQueryOptions(session, fetchImpl, client),
  );

  const reports = feedbackQuery.data
    ? [...feedbackQuery.data].sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id.localeCompare(left.id),
      )
    : [];
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={feedbackQuery.isRefetching}
          onRefresh={() => void feedbackQuery.refetch()}
          tintColor={familyTokens.color.focus}
        />
      }
    >
      {header}
      <InboxHeading />
      {!feedbackQuery.data && feedbackQuery.isPending ? (
        <InboxState message="Loading feedback…" />
      ) : !feedbackQuery.data ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert" style={styles.stateText}>
            Feedback inbox could not be loaded.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void feedbackQuery.refetch()}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : feedbackQuery.error ? (
        <Text accessibilityRole="alert" style={styles.stale}>
          Saved feedback - reconnect to refresh
        </Text>
      ) : null}
      {feedbackQuery.data && reports.length === 0 ? (
        <Text style={styles.empty}>No feedback yet.</Text>
      ) : (
        reports.map((report) => (
          <FeedbackRow key={report.id} report={report} onOpen={onOpen} />
        ))
      )}
    </ScrollView>
  );
}

function InboxHeading() {
  return (
    <View style={styles.headingGroup}>
      <Text style={styles.eyebrow}>SHARED INBOX</Text>
      <Text style={styles.title}>Feedback Inbox</Text>
      <Text style={styles.summary}>
        Both parents can review, edit, and remove these reports.
      </Text>
    </View>
  );
}

function FeedbackRow({
  report,
  onOpen,
}: {
  report: FeedbackListItem;
  onOpen(feedbackId: string): void;
}) {
  const submittedAt = formatDate(report.createdAt);
  return (
    <Pressable
      accessibilityLabel={`Open feedback: ${categoryLabel(report.category)}`}
      accessibilityHint={`${sourceLabel(report.source)}. ${statusLabel(report.status)}. Submitted ${submittedAt}. ${report.descriptionPreview || 'No description provided.'}. ${report.hasDiagnostics ? 'Diagnostics attached.' : 'No diagnostics attached.'}`}
      accessibilityRole="button"
      onPress={() => onOpen(report.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.rowHeading}>
        <Text style={styles.cardTitle}>{categoryLabel(report.category)}</Text>
        <Text style={styles.status}>{statusLabel(report.status)}</Text>
      </View>
      <Text style={styles.meta}>{sourceLabel(report.source)}</Text>
      <Text style={styles.meta}>Submitted {submittedAt}</Text>
      <Text numberOfLines={2} style={styles.preview}>
        {report.descriptionPreview || 'No description provided.'}
      </Text>
      <Text
        accessibilityLabel={
          report.hasDiagnostics
            ? 'Diagnostics attached'
            : 'No diagnostics attached'
        }
        style={report.hasDiagnostics ? styles.diagnostic : styles.noDiagnostic}
      >
        {report.hasDiagnostics ? 'Diagnostics attached' : 'No diagnostics'}
      </Text>
    </Pressable>
  );
}

function InboxState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.state}>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

function categoryLabel(category: FeedbackCategory): string {
  return {
    BROKEN: 'Something broke',
    CONFUSING: 'This is confusing',
    IDEA: 'I have an idea',
  }[category];
}

function sourceLabel(source: FeedbackSource): string {
  return {
    PARENT_IOS: 'Parent app · iOS',
    PARENT_ANDROID: 'Parent app · Android',
    DASHBOARD: 'Kitchen dashboard · Raspberry Pi',
  }[source];
}

function statusLabel(status: FeedbackStatus): string {
  return {
    NEW: 'New',
    REVIEWING: 'Reviewing',
    READY: 'Ready',
    EXPORTED: 'Exported',
    CLOSED: 'Closed',
  }[status];
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: { gap: familyTokens.space.md, padding: familyTokens.space.lg },
  headingGroup: { gap: familyTokens.space.sm },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 28, fontWeight: '800' },
  summary: { color: familyTokens.color.mutedInk, fontSize: 15 },
  stale: {
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#FFF0C2',
    color: familyTokens.color.warning,
    fontWeight: '700',
  },
  empty: {
    padding: familyTokens.space.xl,
    color: familyTokens.color.success,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  card: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  rowHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
  },
  cardTitle: {
    flex: 1,
    color: familyTokens.color.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  status: {
    paddingHorizontal: familyTokens.space.sm,
    paddingVertical: familyTokens.space.xs,
    borderRadius: familyTokens.radius.pill,
    backgroundColor: '#E8F0FF',
    color: familyTokens.color.focus,
    fontWeight: '700',
  },
  meta: { color: familyTokens.color.mutedInk, fontSize: 13 },
  preview: { color: familyTokens.color.ink, fontSize: 15, lineHeight: 21 },
  diagnostic: { color: familyTokens.color.warning, fontWeight: '700' },
  noDiagnostic: { color: familyTokens.color.mutedInk },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    backgroundColor: familyTokens.color.canvas,
  },
  stateText: {
    color: familyTokens.color.mutedInk,
    fontSize: 18,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.lg,
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.focus,
  },
  retryLabel: { color: familyTokens.color.surface, fontWeight: '800' },
  pressed: { opacity: 0.78 },
});
