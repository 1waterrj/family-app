import {
  buildGithubIssueHandoff,
  FamilyApiError,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import {
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_TITLE_LENGTH,
  type FeedbackPublicPreview,
  type FeedbackReport,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createFeedbackOperationUuid,
  createFeedbackPreviewClient,
  feedbackDetailQueryOptions,
  feedbackUpdateMutationOptions,
} from '../features/feedback/feedback-queries';

type FeedbackExportClient = Pick<
  FamilyApiClient,
  'getFeedback' | 'prepareFeedbackPublicPreview' | 'updateFeedback'
>;

type LinkingBoundary = { openURL(url: string): Promise<unknown> };
type ClipboardBoundary = { setStringAsync(value: string): Promise<unknown> };
type CompletedHandoff = 'COPIED' | 'OPENED';
type PendingExportMark = {
  idempotencyKey: string;
  expectedUpdatedAt: string;
  handoff: CompletedHandoff;
};

class ClipboardWriteError extends Error {}

export function FeedbackExportScreen({
  feedbackId,
  session,
  fetch: fetchImpl,
  client,
  maintainerToolsEnabled,
  linking = Linking,
  clipboard = Clipboard,
  randomUUID = createFeedbackOperationUuid,
}: {
  feedbackId: string;
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  client?: FeedbackExportClient;
  maintainerToolsEnabled: boolean;
  linking?: LinkingBoundary;
  clipboard?: ClipboardBoundary;
  randomUUID?: () => string;
}) {
  const queryClient = useQueryClient();
  const acknowledgedHandoffRevision = useRef<string | undefined>(undefined);
  const feedbackQuery = useQuery({
    ...feedbackDetailQueryOptions(session, fetchImpl, feedbackId, client),
    enabled: maintainerToolsEnabled,
  });
  const updateMutation = useMutation(
    feedbackUpdateMutationOptions({
      session,
      fetch: fetchImpl,
      feedbackId,
      queryClient,
      client,
      onCanonicalReport: (canonicalReport) => {
        acknowledgedHandoffRevision.current =
          feedbackReportRevision(canonicalReport);
      },
    }),
  );
  const previewClient =
    client ?? createFeedbackPreviewClient(session, fetchImpl);
  const [report, setReport] = useState<FeedbackReport>();
  const [conflictingReport, setConflictingReport] = useState<FeedbackReport>();
  const [publicTitle, setPublicTitle] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [validatedPreview, setValidatedPreview] =
    useState<FeedbackPublicPreview>();
  const [preparing, setPreparing] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [completedHandoff, setCompletedHandoff] = useState<CompletedHandoff>();
  const [pendingExportMark, setPendingExportMark] =
    useState<PendingExportMark>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const activeQueryScope = useRef<string | undefined>(undefined);
  const observedServerReport = useRef<FeedbackReport | undefined>(undefined);
  const observedServerRevision = useRef<string | undefined>(undefined);
  const draftIsDirty = useRef(false);
  const draftRevision = useRef(0);
  const active = useRef(true);
  const handoffInFlight = useRef(false);
  const queryScope = JSON.stringify([
    session.apiOrigin,
    session.householdId,
    session.actorId,
    session.role,
    feedbackId,
  ]);

  const invalidatePreview = useCallback(() => {
    draftRevision.current += 1;
    setValidatedPreview(undefined);
    setCompletedHandoff(undefined);
    setPendingExportMark(undefined);
    setNotice(undefined);
    setError(undefined);
  }, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      draftRevision.current += 1;
    };
  }, []);

  useEffect(() => {
    const loaded = feedbackQuery.data;
    if (activeQueryScope.current !== queryScope) {
      activeQueryScope.current = queryScope;
      observedServerReport.current = undefined;
      observedServerRevision.current = undefined;
      acknowledgedHandoffRevision.current = undefined;
      draftIsDirty.current = false;
      setReport(undefined);
      setConflictingReport(undefined);
      invalidatePreview();
    }
    if (!loaded || loaded.id !== feedbackId) return;

    const revision = feedbackReportRevision(loaded);
    const observed = observedServerReport.current;
    if (observed?.id === loaded.id && loaded.updatedAt < observed.updatedAt) {
      return;
    }
    if (observedServerRevision.current === revision) return;

    observedServerReport.current = loaded;
    observedServerRevision.current = revision;
    if (acknowledgedHandoffRevision.current === revision) {
      acknowledgedHandoffRevision.current = undefined;
      setReport(loaded);
      setConflictingReport(undefined);
      return;
    }
    acknowledgedHandoffRevision.current = undefined;
    invalidatePreview();
    if (report?.id === loaded.id && draftIsDirty.current) {
      setConflictingReport(loaded);
      return;
    }

    draftIsDirty.current = false;
    setReport(loaded);
    setConflictingReport(undefined);
    setPublicTitle(loaded.title);
    setPublicDescription(loaded.description);
    setIncludeDiagnostics(loaded.diagnosticSnapshot.events.length > 0);
  }, [feedbackId, feedbackQuery.data, invalidatePreview, queryScope, report]);

  if (!maintainerToolsEnabled) {
    return (
      <ExportState message="Maintainer tools are disabled on this phone." />
    );
  }
  if (!feedbackQuery.data && feedbackQuery.isPending) {
    return <ExportState message="Loading public issue draft…" />;
  }
  if (!feedbackQuery.data || !report) {
    return (
      <View style={styles.state}>
        <Text accessibilityRole="alert" style={styles.stateText}>
          This feedback could not be loaded for review.
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

  const changeTitle = (value: string) => {
    draftIsDirty.current = true;
    setPublicTitle(value);
    invalidatePreview();
  };
  const changeDescription = (value: string) => {
    draftIsDirty.current = true;
    setPublicDescription(value);
    invalidatePreview();
  };
  const changeDiagnostics = (value: boolean) => {
    draftIsDirty.current = true;
    setIncludeDiagnostics(value);
    invalidatePreview();
  };

  const useLatestServerCopy = () => {
    if (!conflictingReport) return;
    draftIsDirty.current = false;
    setReport(conflictingReport);
    setPublicTitle(conflictingReport.title);
    setPublicDescription(conflictingReport.description);
    setIncludeDiagnostics(
      conflictingReport.diagnosticSnapshot.events.length > 0,
    );
    setConflictingReport(undefined);
    invalidatePreview();
  };

  const keepLocalDraft = () => {
    if (!conflictingReport) return;
    setReport(conflictingReport);
    draftIsDirty.current = true;
    setConflictingReport(undefined);
    invalidatePreview();
  };

  const preparePreview = async () => {
    if (preparing || handingOff || conflictingReport || !publicTitle.trim()) {
      return;
    }
    const revision = draftRevision.current;
    setPreparing(true);
    setValidatedPreview(undefined);
    setNotice(undefined);
    setError(undefined);
    try {
      const preview = await previewClient.prepareFeedbackPublicPreview(
        feedbackId,
        {
          publicTitle,
          publicDescription,
          includeDiagnostics,
        },
      );
      if (active.current && draftRevision.current === revision) {
        setValidatedPreview(preview);
      }
    } catch {
      if (active.current && draftRevision.current === revision) {
        setError(
          'A public preview could not be prepared. Check the local server setting and try again.',
        );
      }
    } finally {
      if (active.current) setPreparing(false);
    }
  };

  const startExportMark = (handoff: CompletedHandoff): PendingExportMark => {
    const pendingMark = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: report.updatedAt,
      handoff,
    };
    setCompletedHandoff(handoff);
    setPendingExportMark(pendingMark);
    return pendingMark;
  };

  const markExported = async (pendingMark: PendingExportMark) => {
    const updated = await updateMutation.mutateAsync({
      idempotencyKey: pendingMark.idempotencyKey,
      expectedUpdatedAt: pendingMark.expectedUpdatedAt,
      status: 'EXPORTED',
    });
    if (active.current) {
      setReport(updated);
      setPendingExportMark(undefined);
      setNotice(
        pendingMark.handoff === 'COPIED'
          ? 'Validated Markdown copied. Local report marked exported.'
          : 'Opened GitHub. Review and submit the issue in your browser if it is safe.',
      );
    }
  };

  const handleMarkFailure = async (
    caught: unknown,
    pendingMark: PendingExportMark,
  ) => {
    if (!active.current) return;
    if (caught instanceof FamilyApiError && caught.kind === 'CONFLICT') {
      await feedbackQuery.refetch();
      if (active.current) {
        setError(
          pendingMark.handoff === 'COPIED'
            ? 'Validated Markdown was copied, but this feedback changed on the server. Resolve the latest copy before updating local status.'
            : 'Opened GitHub, but this feedback changed on the server. Resolve the latest copy before updating local status.',
        );
      }
      return;
    }
    setError(
      pendingMark.handoff === 'COPIED'
        ? 'Validated Markdown was copied, but the local status was not updated. Retry marking it exported without copying again.'
        : 'Opened GitHub, but the local report could not be marked exported. Try updating the local status.',
    );
  };

  const copyValidatedMarkdown = async () => {
    if (
      !validatedPreview ||
      handingOff ||
      handoffInFlight.current ||
      completedHandoff ||
      conflictingReport
    ) {
      return;
    }
    handoffInFlight.current = true;
    setHandingOff(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await writeValidatedMarkdown(clipboard, markdownFor(validatedPreview));
      if (!active.current) return;
      const pendingMark = startExportMark('COPIED');
      try {
        await markExported(pendingMark);
      } catch (caught) {
        await handleMarkFailure(caught, pendingMark);
      }
    } catch {
      if (active.current) {
        setError('The validated Markdown could not be copied.');
      }
    } finally {
      handoffInFlight.current = false;
      if (active.current) setHandingOff(false);
    }
  };

  const continueToGithub = async () => {
    if (
      !validatedPreview ||
      handingOff ||
      handoffInFlight.current ||
      completedHandoff ||
      conflictingReport
    ) {
      return;
    }
    handoffInFlight.current = true;
    setHandingOff(true);
    setError(undefined);
    setNotice(undefined);
    let copiedForFallback = false;
    try {
      const handoff = buildGithubIssueHandoff(validatedPreview);
      if (handoff.kind === 'URL') {
        await linking.openURL(handoff.url);
      } else {
        await writeValidatedMarkdown(clipboard, handoff.markdown);
        copiedForFallback = true;
        await linking.openURL(handoff.issueComposerUrl);
      }
      if (!active.current) return;
      const pendingMark = startExportMark('OPENED');
      try {
        await markExported(pendingMark);
      } catch (caught) {
        await handleMarkFailure(caught, pendingMark);
      }
    } catch (caught) {
      if (active.current && copiedForFallback) {
        const pendingMark = startExportMark('COPIED');
        setError(
          'GitHub could not be opened, but the validated Markdown was copied.',
        );
        try {
          await markExported(pendingMark);
        } catch (markError) {
          await handleMarkFailure(markError, pendingMark);
        }
      } else if (active.current) {
        setError(
          caught instanceof ClipboardWriteError
            ? 'The validated Markdown could not be copied, so GitHub was not opened.'
            : 'GitHub could not be opened. The validated Markdown is still available to copy.',
        );
      }
    } finally {
      handoffInFlight.current = false;
      if (active.current) setHandingOff(false);
    }
  };

  const retryMarkExported = async () => {
    if (!pendingExportMark || updateMutation.isPending) return;
    setError(undefined);
    try {
      await markExported(pendingExportMark);
    } catch (caught) {
      await handleMarkFailure(caught, pendingExportMark);
    }
  };

  const busy = preparing || handingOff || updateMutation.isPending;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingGroup}>
        <Text style={styles.eyebrow}>MAINTAINER TOOL</Text>
        <Text style={styles.title}>Prepare public issue</Text>
        <Text style={styles.intro}>
          The family server must validate every edit. GitHub opens in your
          browser for your final review and submission.
        </Text>
      </View>

      {conflictingReport ? (
        <View style={styles.conflict}>
          <Text accessibilityRole="alert" style={styles.conflictText}>
            This feedback changed on the server while you were editing. Resolve
            the conflict before preparing a public preview.
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={handingOff}
              onPress={keepLocalDraft}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Keep my draft</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={handingOff}
              onPress={useLatestServerCopy}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                Use latest server copy
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Public draft</Text>
        <Text style={styles.label}>Public title</Text>
        <TextInput
          accessibilityLabel="Public title"
          editable={!handingOff && !completedHandoff}
          maxLength={MAX_FEEDBACK_TITLE_LENGTH}
          onChangeText={changeTitle}
          style={styles.input}
          value={publicTitle}
        />
        <Text style={styles.label}>Public description</Text>
        <TextInput
          accessibilityLabel="Public description"
          editable={!handingOff && !completedHandoff}
          maxLength={MAX_FEEDBACK_DESCRIPTION_LENGTH}
          multiline
          onChangeText={changeDescription}
          style={[styles.input, styles.textArea]}
          textAlignVertical="top"
          value={publicDescription}
        />
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Include sanitized diagnostics</Text>
            <Text style={styles.helper}>
              The server may still omit events it cannot safely validate.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Include sanitized diagnostics"
            accessibilityState={{
              checked: includeDiagnostics,
              disabled: handingOff || Boolean(completedHandoff),
            }}
            disabled={handingOff || Boolean(completedHandoff)}
            onValueChange={changeDiagnostics}
            value={includeDiagnostics}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            busy: preparing,
            disabled:
              busy ||
              Boolean(completedHandoff) ||
              Boolean(conflictingReport) ||
              !publicTitle.trim(),
          }}
          disabled={
            busy ||
            Boolean(completedHandoff) ||
            Boolean(conflictingReport) ||
            !publicTitle.trim()
          }
          onPress={() => void preparePreview()}
          style={[
            styles.primaryButton,
            (busy ||
              Boolean(completedHandoff) ||
              Boolean(conflictingReport) ||
              !publicTitle.trim()) &&
              styles.disabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {preparing ? 'Preparing preview…' : 'Prepare preview'}
          </Text>
        </Pressable>
      </View>

      {validatedPreview ? (
        <View style={styles.previewSection}>
          <Text style={styles.sectionTitle}>Validated public preview</Text>
          <Text style={styles.previewLabel}>Exact title</Text>
          <Text selectable style={styles.previewTitle}>
            {validatedPreview.title}
          </Text>
          <Text style={styles.previewLabel}>Exact Markdown body</Text>
          <Text selectable style={styles.markdown}>
            {validatedPreview.body}
          </Text>
          <Text style={styles.previewLabel}>Requested labels</Text>
          <Text selectable style={styles.labels}>
            {validatedPreview.labels.join(', ')}
          </Text>
          {validatedPreview.redactions.length > 0 ? (
            <Text style={styles.redactions}>
              Server redactions: {validatedPreview.redactions.join(', ')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text accessibilityLiveRegion="polite" style={styles.helper}>
          Validate the current draft before copying or opening it.
        </Text>
      )}

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
          accessibilityLabel="Working on public issue handoff"
          color={familyTokens.color.focus}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Copy validated Markdown"
          accessibilityRole="button"
          disabled={
            !validatedPreview ||
            busy ||
            Boolean(completedHandoff) ||
            Boolean(conflictingReport)
          }
          onPress={() => void copyValidatedMarkdown()}
          style={[
            styles.secondaryButton,
            (!validatedPreview ||
              busy ||
              Boolean(completedHandoff) ||
              Boolean(conflictingReport)) &&
              styles.disabled,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Copy Markdown</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Continue to GitHub"
          accessibilityRole="button"
          accessibilityState={{
            busy: handingOff,
            disabled:
              !validatedPreview ||
              busy ||
              Boolean(completedHandoff) ||
              Boolean(conflictingReport),
          }}
          disabled={
            !validatedPreview ||
            busy ||
            Boolean(completedHandoff) ||
            Boolean(conflictingReport)
          }
          onPress={() => void continueToGithub()}
          style={[
            styles.primaryButton,
            (!validatedPreview ||
              busy ||
              Boolean(completedHandoff) ||
              Boolean(conflictingReport)) &&
              styles.disabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>Continue to GitHub</Text>
        </Pressable>
      </View>

      {completedHandoff && pendingExportMark ? (
        <Pressable
          accessibilityLabel={
            completedHandoff === 'COPIED'
              ? 'Retry marking copied draft'
              : 'Try updating local status'
          }
          accessibilityRole="button"
          disabled={updateMutation.isPending}
          onPress={() => void retryMarkExported()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {completedHandoff === 'COPIED'
              ? 'Retry marking copied draft'
              : 'Try updating local status'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function markdownFor(preview: FeedbackPublicPreview): string {
  return `${preview.title}\n\n${preview.body}`;
}

function feedbackReportRevision(report: FeedbackReport): string {
  return JSON.stringify(report);
}

async function writeValidatedMarkdown(
  clipboard: ClipboardBoundary,
  markdown: string,
): Promise<void> {
  const copied = await clipboard.setStringAsync(markdown);
  if (copied === false) throw new ClipboardWriteError();
}

function ExportState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.state}>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
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
  intro: { color: familyTokens.color.mutedInk, fontSize: 15, lineHeight: 21 },
  section: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  conflict: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    borderWidth: 2,
    borderColor: familyTokens.color.warning,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: '#FFF8E6',
  },
  conflictText: {
    color: familyTokens.color.ink,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  previewSection: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.lg,
    borderWidth: 2,
    borderColor: familyTokens.color.success,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  sectionTitle: {
    color: familyTokens.color.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  label: { color: familyTokens.color.ink, fontSize: 15, fontWeight: '700' },
  input: {
    minHeight: familyTokens.touch.phoneMinimum,
    padding: familyTokens.space.md,
    borderWidth: 1,
    borderColor: '#C7CED1',
    borderRadius: familyTokens.radius.small,
    color: familyTokens.color.ink,
    fontSize: 16,
  },
  textArea: { minHeight: 112 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.md,
  },
  switchCopy: { flex: 1, gap: familyTokens.space.xs },
  helper: { color: familyTokens.color.mutedInk, fontSize: 14, lineHeight: 20 },
  previewLabel: {
    marginTop: familyTokens.space.sm,
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  previewTitle: {
    color: familyTokens.color.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  markdown: {
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#F2F4F5',
    color: familyTokens.color.ink,
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 19,
  },
  labels: { color: familyTokens.color.ink, fontSize: 14 },
  redactions: { color: familyTokens.color.warning, fontWeight: '700' },
  actions: { gap: familyTokens.space.sm },
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
    paddingHorizontal: familyTokens.space.lg,
    borderWidth: 1,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.small,
  },
  secondaryButtonText: { color: familyTokens.color.focus, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  error: {
    color: familyTokens.color.danger,
    fontWeight: '700',
    lineHeight: 20,
  },
  success: {
    color: familyTokens.color.success,
    fontWeight: '700',
    lineHeight: 20,
  },
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
