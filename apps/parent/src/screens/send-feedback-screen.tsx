import {
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  type ClientDiagnosticSnapshot,
  type FeedbackCategory,
  type FeedbackDiagnosticEvent,
  type FeedbackScreen,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useState } from 'react';
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
  useFeedbackRuntime,
  useRecordMountedFeedbackScreen,
} from '../features/feedback/feedback-runtime';

export type SendFeedbackContext = {
  category: FeedbackCategory;
  screen: FeedbackScreen;
};

const categoryChoices: ReadonlyArray<{
  category: FeedbackCategory;
  label: string;
}> = [
  { category: 'BROKEN', label: 'Something broke' },
  { category: 'CONFUSING', label: 'This is confusing' },
  { category: 'IDEA', label: 'I have an idea' },
];

export function SendFeedbackScreen({
  context,
  onCancel = () => undefined,
}: {
  context?: SendFeedbackContext;
  onCancel?: () => void;
}) {
  const runtime = useFeedbackRuntime();
  useRecordMountedFeedbackScreen(context?.screen ?? 'PARENT_FEEDBACK');
  const [category, setCategory] = useState<FeedbackCategory | undefined>(
    context?.category,
  );
  const [description, setDescription] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'delivered' | 'queued' | 'saved'>();
  const [submittedSnapshot, setSubmittedSnapshot] =
    useState<ClientDiagnosticSnapshot>();
  const [submittedDiagnosticsIncluded, setSubmittedDiagnosticsIncluded] =
    useState<boolean>();
  const [error, setError] = useState<string>();
  const snapshot = submittedSnapshot ?? runtime.preview(includeDiagnostics);
  const displayedDiagnosticsIncluded =
    submittedDiagnosticsIncluded ?? includeDiagnostics;

  async function sendFeedback() {
    if (!category || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const diagnosticsIncluded = includeDiagnostics;
      const submission = await runtime.submit({
        category,
        description,
        includeDiagnostics: diagnosticsIncluded,
      });
      setSubmittedSnapshot(submission.diagnosticSnapshot);
      setSubmittedDiagnosticsIncluded(diagnosticsIncluded);
      setResult(submission.status);
      setCategory(context?.category);
      setDescription('');
      setIncludeDiagnostics(true);
    } catch {
      setError('Feedback could not be saved on this phone. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingGroup}>
        <Text style={styles.eyebrow}>HELP US IMPROVE</Text>
        <Text style={styles.title}>Send feedback</Text>
        <Text style={styles.intro}>
          Choose the option that best matches what you noticed.
        </Text>
      </View>

      <View accessibilityRole="radiogroup" style={styles.choices}>
        {categoryChoices.map((choice) => {
          const selected = category === choice.category;
          const fixed = context !== undefined;
          return (
            <Pressable
              key={choice.category}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selected,
                disabled: submitting || fixed,
              }}
              disabled={submitting || fixed}
              onPress={() => setCategory(choice.category)}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
                (submitting || fixed) && !selected && styles.disabled,
              ]}
            >
              <View
                accessibilityElementsHidden
                style={[styles.selectionMark, selected && styles.markSelected]}
              >
                <Text style={styles.selectionMarkText}>
                  {selected ? '✓' : ''}
                </Text>
              </View>
              <Text style={styles.choiceLabel}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Tell us more (optional)</Text>
        <TextInput
          accessibilityLabel="Tell us more (optional)"
          value={description}
          onChangeText={setDescription}
          maxLength={MAX_FEEDBACK_DESCRIPTION_LENGTH}
          editable={!submitting && !result}
          multiline
          placeholder="What happened, or what would make this better?"
          placeholderTextColor={familyTokens.color.mutedInk}
          style={styles.input}
          textAlignVertical="top"
        />
        <Text style={styles.characterCount}>
          {description.length.toLocaleString()} / 2,000 characters
        </Text>
      </View>

      <View style={styles.diagnosticsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showDiagnostics }}
          onPress={() => setShowDiagnostics((visible) => !visible)}
          style={({ pressed }) => [
            styles.disclosure,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.disclosureCopy}>
            <Text style={styles.cardTitle}>
              {showDiagnostics
                ? 'Hide attached diagnostics'
                : 'Review attached diagnostics'}
            </Text>
            <Text style={styles.cardSummary}>
              {displayedDiagnosticsIncluded
                ? `${snapshot.events.length} recent ${snapshot.events.length === 1 ? 'event' : 'events'} selected`
                : 'Recent event timeline is off'}
            </Text>
          </View>
          <Text accessibilityElementsHidden style={styles.chevron}>
            {showDiagnostics ? '⌃' : '⌄'}
          </Text>
        </Pressable>

        {showDiagnostics ? (
          <DiagnosticDisclosure
            snapshot={snapshot}
            diagnosticsIncluded={displayedDiagnosticsIncluded}
            switchValue={displayedDiagnosticsIncluded}
            disabled={submitting || result !== undefined}
            onIncludeDiagnosticsChange={setIncludeDiagnostics}
          />
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {result ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {result === 'delivered'
            ? 'Thanks - your feedback was saved.'
            : result === 'queued'
              ? 'Saved on this phone - it will send when your family server reconnects.'
              : 'Your feedback was saved. We could not confirm whether it sent. Check the Feedback tab to try again.'}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
            submitting && styles.disabled,
          ]}
        >
          <Text style={styles.secondaryLabel}>
            {result ? 'Done' : 'Cancel'}
          </Text>
        </Pressable>
        {!result ? (
          <Pressable
            accessibilityLabel="Send feedback"
            accessibilityRole="button"
            accessibilityState={{
              busy: submitting,
              disabled: !category || submitting,
            }}
            disabled={!category || submitting}
            onPress={() => void sendFeedback()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (!category || submitting) && styles.disabled,
            ]}
          >
            {submitting ? (
              <View style={styles.sendingStatus}>
                <ActivityIndicator
                  accessibilityElementsHidden
                  color={familyTokens.color.surface}
                />
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.primaryLabel}
                >
                  Sending feedback…
                </Text>
              </View>
            ) : (
              <Text style={styles.primaryLabel}>Send feedback</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function DiagnosticDisclosure({
  snapshot,
  diagnosticsIncluded,
  switchValue,
  disabled,
  onIncludeDiagnosticsChange,
}: {
  snapshot: ClientDiagnosticSnapshot;
  diagnosticsIncluded: boolean;
  switchValue: boolean;
  disabled: boolean;
  onIncludeDiagnosticsChange(value: boolean): void;
}) {
  return (
    <View style={styles.diagnosticDetails}>
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.switchLabel}>Include recent diagnostics</Text>
          <Text style={styles.explanation}>
            Turn this off to attach no recent activity events.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Include recent diagnostics"
          accessibilityState={{ checked: switchValue, disabled }}
          disabled={disabled}
          value={switchValue}
          onValueChange={onIncludeDiagnosticsChange}
          trackColor={{ false: '#C8C1B7', true: familyTokens.color.focus }}
          thumbColor={familyTokens.color.surface}
        />
      </View>

      <Text style={styles.snapshotHeading}>Exactly what will be attached</Text>
      <Text style={styles.snapshotLine}>
        Platform: {sourceLabel(snapshot.source)}
      </Text>
      <Text style={styles.snapshotLine}>
        App version: {snapshot.appVersion}
      </Text>
      <Text style={styles.snapshotLine}>
        Current screen: {screenLabel(snapshot.currentScreen)}
      </Text>
      <Text style={styles.snapshotLine}>
        Recent event timeline:{' '}
        {diagnosticsIncluded
          ? `${snapshot.events.length} ${snapshot.events.length === 1 ? 'event' : 'events'}`
          : 'Not attached'}
      </Text>
      {diagnosticsIncluded
        ? snapshot.events.map((event, index) => (
            <Text key={`${event.at}-${index}`} style={styles.eventLine}>
              {index + 1}. {eventLabel(event)}
            </Text>
          ))
        : null}

      <Text style={styles.privacyHeading}>Privacy limits</Text>
      <Text style={styles.explanation}>
        Diagnostics keep at most the latest 15 minutes, 100 events, and 24 KiB.
        Older events are removed first.
      </Text>
      <Text style={styles.explanation}>
        The allowlist includes only app platform and version, screen changes,
        connection state, and coarse API result details such as operation,
        status, error code, duration bucket, timestamp, and request reference.
      </Text>
      <Text style={styles.explanation}>
        Diagnostics never include names, calendar titles, balances, chore notes,
        credentials, URLs, query strings, or request and response bodies.
      </Text>
    </View>
  );
}

function eventLabel(event: FeedbackDiagnosticEvent): string {
  if (event.kind === 'SCREEN') {
    return `${event.at} · Screen · ${screenLabel(event.screen)}`;
  }
  if (event.kind === 'NETWORK') {
    return `${event.at} · Connection · ${event.state === 'ONLINE' ? 'Online' : 'Offline'}`;
  }
  return [
    event.at,
    'API result',
    event.operation,
    event.outcome,
    `status ${event.status ?? 'none'}`,
    `error ${event.errorCode ?? 'none'}`,
    event.durationBucket,
    `request ${event.requestId ?? 'none'}`,
  ].join(' · ');
}

function sourceLabel(source: ClientDiagnosticSnapshot['source']): string {
  if (source === 'PARENT_IOS') return 'Parent iOS';
  if (source === 'PARENT_ANDROID') return 'Parent Android';
  return 'Kitchen dashboard';
}

function screenLabel(screen: FeedbackScreen): string {
  const labels: Record<FeedbackScreen, string> = {
    SETUP: 'Setup',
    PARENT_HOME: 'Parent home',
    PARENT_APPROVALS: 'Parent approvals',
    PARENT_CHORES: 'Parent chores',
    PARENT_REWARDS: 'Parent rewards',
    PARENT_FEEDBACK: 'Parent feedback',
    PARENT_FEEDBACK_DETAIL: 'Parent feedback detail',
    PARENT_FEEDBACK_EXPORT: 'Parent feedback export',
    DASHBOARD_HOME: 'Dashboard home',
    DASHBOARD_CHORE_BOARD: 'Dashboard chore board',
    DASHBOARD_CHORE_DETAIL: 'Dashboard chore detail',
    DASHBOARD_ACTIVE_CHORE: 'Dashboard active chore',
    DASHBOARD_FEEDBACK: 'Dashboard feedback',
  };
  return labels[screen];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: {
    gap: familyTokens.space.lg,
    padding: familyTokens.space.lg,
    paddingBottom: familyTokens.space.xl,
  },
  headingGroup: { gap: familyTokens.space.sm },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 32, fontWeight: '800' },
  intro: { color: familyTokens.color.mutedInk, fontSize: 16, lineHeight: 23 },
  choices: { gap: familyTokens.space.sm },
  choice: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.md,
    borderWidth: 2,
    borderColor: '#D8D0C4',
    borderRadius: familyTokens.radius.large,
    backgroundColor: familyTokens.color.surface,
  },
  choiceSelected: {
    borderColor: familyTokens.color.focus,
    backgroundColor: '#EDF4F5',
  },
  selectionMark: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: familyTokens.color.mutedInk,
    borderRadius: familyTokens.radius.pill,
  },
  markSelected: {
    borderColor: familyTokens.color.focus,
    backgroundColor: familyTokens.color.focus,
  },
  selectionMarkText: {
    color: familyTokens.color.surface,
    fontSize: 16,
    fontWeight: '800',
  },
  choiceLabel: {
    color: familyTokens.color.ink,
    fontSize: 18,
    fontWeight: '700',
  },
  fieldGroup: { gap: familyTokens.space.sm },
  label: { color: familyTokens.color.ink, fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 132,
    padding: familyTokens.space.md,
    borderWidth: 2,
    borderColor: '#D8D0C4',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
    color: familyTokens.color.ink,
    fontSize: 16,
  },
  characterCount: {
    alignSelf: 'flex-end',
    color: familyTokens.color.mutedInk,
    fontSize: 13,
  },
  diagnosticsCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D8D0C4',
    borderRadius: familyTokens.radius.large,
    backgroundColor: familyTokens.color.surface,
  },
  disclosure: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
    padding: familyTokens.space.md,
  },
  disclosureCopy: { flex: 1, gap: 3 },
  cardTitle: { color: familyTokens.color.ink, fontSize: 16, fontWeight: '700' },
  cardSummary: { color: familyTokens.color.mutedInk, fontSize: 14 },
  chevron: { color: familyTokens.color.focus, fontSize: 22 },
  diagnosticDetails: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.md,
    borderTopWidth: 1,
    borderTopColor: '#E5DED4',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
  },
  switchCopy: { flex: 1, gap: 3 },
  switchLabel: {
    color: familyTokens.color.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  snapshotHeading: {
    marginTop: familyTokens.space.sm,
    color: familyTokens.color.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  snapshotLine: { color: familyTokens.color.ink, fontSize: 14, lineHeight: 20 },
  eventLine: {
    color: familyTokens.color.mutedInk,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  privacyHeading: {
    marginTop: familyTokens.space.sm,
    color: familyTokens.color.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  explanation: {
    color: familyTokens.color.mutedInk,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: { flexDirection: 'row', gap: familyTokens.space.md },
  primaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.pill,
    backgroundColor: familyTokens.color.focus,
    paddingHorizontal: familyTokens.space.md,
  },
  secondaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.pill,
    backgroundColor: familyTokens.color.surface,
    paddingHorizontal: familyTokens.space.md,
  },
  primaryLabel: {
    color: familyTokens.color.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  sendingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.sm,
  },
  secondaryLabel: {
    color: familyTokens.color.focus,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  error: { color: familyTokens.color.danger, fontSize: 15, fontWeight: '600' },
  success: {
    color: familyTokens.color.success,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
});
