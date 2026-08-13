import {
  FamilyApiError,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import {
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_TITLE_LENGTH,
  type FeedbackCategory,
  type FeedbackDiagnosticEvent,
  type FeedbackReport,
  type FeedbackScreen,
  type FeedbackSource,
  type FeedbackStatus,
  type UpdateFeedbackCommand,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

import {
  createFeedbackOperationUuid,
  feedbackDeleteMutationOptions,
  feedbackDetailQueryOptions,
  feedbackUpdateMutationOptions,
} from '../features/feedback/feedback-queries';
import { HighlightedPrivateText } from '../features/feedback/highlighted-private-text';

type FeedbackReviewClient = Pick<
  FamilyApiClient,
  'getFeedback' | 'updateFeedback' | 'deleteFeedback'
>;

type DiagnosticDraft = {
  key: string;
  event: FeedbackDiagnosticEvent;
};

type FeedbackDraft = {
  title: string;
  description: string;
  diagnosticEvents: DiagnosticDraft[];
  status: ReviewStatus | undefined;
  publicIssueUrl: string;
};

type ReviewStatus = Exclude<FeedbackStatus, 'EXPORTED'>;

const statusChoices = [
  ['NEW', 'New'],
  ['REVIEWING', 'Reviewing'],
  ['READY', 'Ready'],
  ['CLOSED', 'Closed'],
] as const satisfies ReadonlyArray<readonly [ReviewStatus, string]>;

export function FeedbackDetailScreen({
  feedbackId,
  session,
  fetch: fetchImpl,
  client,
  randomUUID = createFeedbackOperationUuid,
  maintainerToolsEnabled = false,
  onPreparePublicIssue = () => undefined,
  onDeleted = () => undefined,
}: {
  feedbackId: string;
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  client?: FeedbackReviewClient;
  randomUUID?: () => string;
  maintainerToolsEnabled?: boolean;
  onPreparePublicIssue?(feedbackId: string): void;
  onDeleted?(): void;
}) {
  const queryClient = useQueryClient();
  const feedbackQuery = useQuery(
    feedbackDetailQueryOptions(session, fetchImpl, feedbackId, client),
  );
  const updateMutation = useMutation(
    feedbackUpdateMutationOptions({
      session,
      fetch: fetchImpl,
      feedbackId,
      queryClient,
      client,
    }),
  );
  const deleteMutation = useMutation(
    feedbackDeleteMutationOptions({
      session,
      fetch: fetchImpl,
      feedbackId,
      queryClient,
      client,
    }),
  );
  const [draft, setDraft] = useState<FeedbackDraft>();
  const [reviewedReport, setReviewedReport] = useState<FeedbackReport>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const initializedFeedbackId = useRef<string | undefined>(undefined);
  const loadedUpdatedAt = useRef<string | undefined>(undefined);
  const draftIsDirty = useRef(false);

  useEffect(() => {
    const report = feedbackQuery.data;
    if (
      !report ||
      (initializedFeedbackId.current === report.id &&
        (draftIsDirty.current ||
          loadedUpdatedAt.current === report.updatedAt ||
          (loadedUpdatedAt.current !== undefined &&
            report.updatedAt < loadedUpdatedAt.current)))
    ) {
      return;
    }
    initializedFeedbackId.current = report.id;
    loadedUpdatedAt.current = report.updatedAt;
    draftIsDirty.current = false;
    setReviewedReport(report);
    setDraft(createDraft(report));
    setRevisionConflict(false);
  }, [feedbackQuery.data]);

  if (!feedbackQuery.data && feedbackQuery.isPending) {
    return <DetailState message="Loading feedback…" />;
  }
  if (!feedbackQuery.data || !draft || !reviewedReport) {
    return (
      <View style={styles.state}>
        <Text accessibilityRole="alert" style={styles.stateText}>
          This feedback could not be loaded.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void feedbackQuery.refetch()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const busy = updateMutation.isPending || deleteMutation.isPending;
  const titleFindings =
    draft.title === reviewedReport.title
      ? reviewedReport.privacyFindings.filter(
          (finding) => finding.field === 'TITLE',
        )
      : [];
  const descriptionFindings =
    draft.description === reviewedReport.description
      ? reviewedReport.privacyFindings.filter(
          (finding) => finding.field === 'DESCRIPTION',
        )
      : [];
  const findingsNeedRefresh =
    draft.title !== reviewedReport.title ||
    draft.description !== reviewedReport.description;

  const changeDraft = (change: Partial<FeedbackDraft>) => {
    draftIsDirty.current = true;
    setDraft((current) => (current ? { ...current, ...change } : current));
    setNotice(undefined);
    setError(undefined);
  };

  const save = async () => {
    if (busy || revisionConflict) return;
    if (!draft.title.trim()) {
      setError('Add a title before saving.');
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      const command: UpdateFeedbackCommand = {
        idempotencyKey: randomUUID(),
        expectedUpdatedAt: reviewedReport.updatedAt,
        title: draft.title,
        description: draft.description,
        diagnosticEvents: draft.diagnosticEvents.map(({ event }) => event),
        publicIssueUrl: draft.publicIssueUrl.trim() || null,
        ...(draft.status ? { status: draft.status } : {}),
      };
      const report = await updateMutation.mutateAsync(command);
      loadedUpdatedAt.current = report.updatedAt;
      draftIsDirty.current = false;
      setReviewedReport(report);
      setDraft(createDraft(report));
      setRevisionConflict(false);
      setNotice('Changes saved.');
    } catch (caught) {
      if (caught instanceof FamilyApiError && caught.kind === 'CONFLICT') {
        setRevisionConflict(true);
      } else {
        setError('Feedback changes could not be saved. Try again.');
      }
    }
  };

  const rebaseOntoLatest = async () => {
    const result = await feedbackQuery.refetch();
    if (!result.data) {
      setError('The latest feedback could not be loaded. Try again.');
      return;
    }
    loadedUpdatedAt.current = result.data.updatedAt;
    setReviewedReport(result.data);
    setRevisionConflict(false);
    setError(undefined);
    setNotice('Latest server copy loaded. Review your edits and save again.');
  };

  const removeDiagnostic = (key: string) => {
    changeDraft({
      diagnosticEvents: draft.diagnosticEvents.filter(
        (candidate) => candidate.key !== key,
      ),
    });
  };

  const deleteReport = async () => {
    if (busy) return;
    setError(undefined);
    try {
      await deleteMutation.mutateAsync({ idempotencyKey: randomUUID() });
      onDeleted();
    } catch {
      setConfirmingDelete(false);
      setError('Feedback could not be deleted. Try again.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingGroup}>
        <Text style={styles.eyebrow}>PARENT REVIEW</Text>
        <Text style={styles.title}>
          {categoryLabel(reviewedReport.category)}
        </Text>
        <Text style={styles.meta}>{sourceLabel(reviewedReport.source)}</Text>
        <Text style={styles.meta}>App version {reviewedReport.appVersion}</Text>
        <Text style={styles.meta}>
          Current screen: {screenLabel(reviewedReport.screen)}
        </Text>
      </View>

      {feedbackQuery.error ? (
        <Text accessibilityRole="alert" style={styles.warningBanner}>
          This saved copy could not be refreshed.
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Private report</Text>
        <Text style={styles.label}>Title</Text>
        <TextInput
          accessibilityLabel="Feedback title"
          editable={!busy}
          maxLength={MAX_FEEDBACK_TITLE_LENGTH}
          onChangeText={(title) => changeDraft({ title })}
          style={styles.input}
          value={draft.title}
        />
        <Text style={styles.previewLabel}>Privacy review</Text>
        <HighlightedPrivateText text={draft.title} findings={titleFindings} />

        <Text style={styles.label}>Description</Text>
        <TextInput
          accessibilityLabel="Feedback description"
          editable={!busy}
          maxLength={MAX_FEEDBACK_DESCRIPTION_LENGTH}
          multiline
          onChangeText={(description) => changeDraft({ description })}
          style={[styles.input, styles.textArea]}
          textAlignVertical="top"
          value={draft.description}
        />
        <Text style={styles.previewLabel}>Privacy review</Text>
        <HighlightedPrivateText
          text={draft.description}
          findings={descriptionFindings}
        />
        {findingsNeedRefresh ? (
          <Text style={styles.helper}>
            Save edits to refresh the privacy warnings. Highlighting is only a
            review aid.
          </Text>
        ) : reviewedReport.privacyFindings.length > 0 ? (
          <Text style={styles.helper}>
            Check every highlighted item before preparing anything public.
          </Text>
        ) : (
          <Text style={styles.helper}>
            No likely private text was found. Review is still required.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Workflow status</Text>
        {reviewedReport.status === 'EXPORTED' && !draft.status ? (
          <Text style={styles.helper}>
            Current status: Exported by maintainer handoff. Choose a review
            status only if you intend to change it.
          </Text>
        ) : null}
        <View accessibilityRole="radiogroup" style={styles.statusChoices}>
          {statusChoices.map(([status, label]) => (
            <Pressable
              key={status}
              accessibilityRole="radio"
              accessibilityState={{
                checked: draft.status === status,
                disabled: busy,
              }}
              disabled={busy}
              onPress={() => changeDraft({ status })}
              style={[
                styles.statusChoice,
                draft.status === status && styles.statusChoiceSelected,
              ]}
            >
              <Text style={styles.statusChoiceText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Public issue URL (optional)</Text>
        <TextInput
          accessibilityLabel="Public issue URL (optional)"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          keyboardType="url"
          onChangeText={(publicIssueUrl) => changeDraft({ publicIssueUrl })}
          placeholder="https://…"
          style={styles.input}
          value={draft.publicIssueUrl}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Attached diagnostics</Text>
        <Text style={styles.helper}>
          {draft.diagnosticEvents.length}{' '}
          {draft.diagnosticEvents.length === 1
            ? 'diagnostic event'
            : 'diagnostic events'}{' '}
          attached
        </Text>
        {draft.diagnosticEvents.map(({ key, event }) => (
          <View key={key} style={styles.eventRow}>
            <Text style={styles.eventText}>{diagnosticLabel(event)}</Text>
            <Pressable
              accessibilityLabel={`Remove diagnostic event ${Number(key) + 1}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => removeDiagnostic(key)}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          </View>
        ))}
        {draft.diagnosticEvents.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => changeDraft({ diagnosticEvents: [] })}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              Remove all diagnostics
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.helper}>No diagnostic events attached.</Text>
        )}
      </View>

      {revisionConflict ? (
        <View style={styles.conflict}>
          <Text accessibilityRole="alert" style={styles.error}>
            This feedback changed on the server. Load the latest copy before
            saving again.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void rebaseOntoLatest()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              Load latest and keep my edits
            </Text>
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {notice}
        </Text>
      ) : null}
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Saving feedback"
          color={familyTokens.color.focus}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          busy: updateMutation.isPending,
          disabled: busy || revisionConflict,
        }}
        disabled={busy || revisionConflict}
        onPress={() => void save()}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Save changes</Text>
      </Pressable>

      {maintainerToolsEnabled ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onPreparePublicIssue(feedbackId)}
          style={styles.maintainerButton}
        >
          <Text style={styles.maintainerButtonText}>Prepare public issue</Text>
        </Pressable>
      ) : null}

      <View style={styles.dangerZone}>
        <Text style={styles.sectionTitle}>Delete local report</Text>
        {!confirmingDelete ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setConfirmingDelete(true)}
            style={styles.deleteButton}
          >
            <Text style={styles.deleteButtonText}>Delete feedback</Text>
          </Pressable>
        ) : (
          <View
            accessibilityLabel="Delete this feedback permanently?"
            accessibilityRole="alert"
            style={styles.confirmation}
          >
            <Text style={styles.confirmationText}>
              Delete this feedback permanently? This cannot remove a separate
              public issue.
            </Text>
            <View style={styles.confirmationActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirmingDelete(false)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Cancel deletion</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void deleteReport()}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteButtonText}>
                  Delete feedback permanently
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function createDraft(report: FeedbackReport): FeedbackDraft {
  return {
    title: report.title,
    description: report.description,
    diagnosticEvents: report.diagnosticSnapshot.events.map((event, index) => ({
      key: String(index),
      event,
    })),
    status: report.status === 'EXPORTED' ? undefined : report.status,
    publicIssueUrl: report.publicIssueUrl ?? '',
  };
}

function DetailState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.state}>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

function diagnosticLabel(event: FeedbackDiagnosticEvent): string {
  if (event.kind === 'SCREEN') {
    return `${event.at} · Screen ${screenLabel(event.screen)}`;
  }
  if (event.kind === 'NETWORK') {
    return `${event.at} · Network ${event.state.toLowerCase()}`;
  }
  return `${event.at} · API ${event.operation} · ${event.outcome.toLowerCase()} · status ${event.status ?? 'none'} · error ${event.errorCode ?? 'none'} · duration ${event.durationBucket.toLowerCase()} · request ${event.requestId ?? 'none'}`;
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

function screenLabel(screen: FeedbackScreen): string {
  return screen
    .toLowerCase()
    .split('_')
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(' ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: { gap: familyTokens.space.md, padding: familyTokens.space.lg },
  headingGroup: { gap: familyTokens.space.xs },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 28, fontWeight: '800' },
  meta: { color: familyTokens.color.mutedInk, fontSize: 14 },
  section: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  sectionTitle: {
    color: familyTokens.color.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  conflict: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.md,
    borderWidth: 2,
    borderColor: familyTokens.color.warning,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#FFF8E6',
  },
  label: {
    marginTop: familyTokens.space.sm,
    color: familyTokens.color.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    minHeight: familyTokens.touch.phoneMinimum,
    padding: familyTokens.space.md,
    borderWidth: 1,
    borderColor: '#C7CED1',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
    color: familyTokens.color.ink,
    fontSize: 16,
  },
  textArea: { minHeight: 112 },
  previewLabel: {
    color: familyTokens.color.warning,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  helper: { color: familyTokens.color.mutedInk, fontSize: 14, lineHeight: 20 },
  statusChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: familyTokens.space.sm,
  },
  statusChoice: {
    minHeight: familyTokens.touch.phoneMinimum,
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderWidth: 1,
    borderColor: '#C7CED1',
    borderRadius: familyTokens.radius.pill,
  },
  statusChoiceSelected: {
    borderColor: familyTokens.color.focus,
    backgroundColor: '#E8F0FF',
  },
  statusChoiceText: { color: familyTokens.color.ink, fontWeight: '700' },
  eventRow: {
    gap: familyTokens.space.sm,
    paddingVertical: familyTokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C7CED1',
  },
  eventText: { color: familyTokens.color.ink, fontSize: 14, lineHeight: 20 },
  removeButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#FCE8E8',
  },
  removeButtonText: { color: familyTokens.color.danger, fontWeight: '800' },
  primaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.lg,
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.focus,
  },
  primaryButtonText: { color: familyTokens.color.surface, fontWeight: '800' },
  secondaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderWidth: 1,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.small,
  },
  secondaryButtonText: { color: familyTokens.color.focus, fontWeight: '800' },
  maintainerButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.child.secondary,
  },
  maintainerButtonText: {
    color: familyTokens.color.surface,
    fontWeight: '800',
  },
  warningBanner: {
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#FFF0C2',
    color: familyTokens.color.warning,
    fontWeight: '700',
  },
  error: { color: familyTokens.color.danger, fontWeight: '700' },
  success: { color: familyTokens.color.success, fontWeight: '700' },
  dangerZone: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    borderWidth: 1,
    borderColor: '#E2B4B4',
    borderRadius: familyTokens.radius.medium,
  },
  deleteButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.danger,
  },
  deleteButtonText: { color: familyTokens.color.surface, fontWeight: '800' },
  confirmation: { gap: familyTokens.space.md },
  confirmationText: { color: familyTokens.color.danger, fontWeight: '700' },
  confirmationActions: { gap: familyTokens.space.sm },
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
});
