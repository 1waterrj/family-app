import { parseDevelopmentCredential } from '@family/api-client/development-credential';
import { familyTokens } from '@family/design-tokens';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ParentSessionStore } from '../auth/session-store';
import { ScreenStateAction } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';

export function SetupScreen({
  sessionStore,
  onComplete,
  onReportProblem,
  footer,
}: {
  sessionStore: ParentSessionStore;
  onComplete(): void;
  onReportProblem?: OpenFeedbackDraft;
  footer?: ReactNode;
}) {
  const [credentialText, setCredentialText] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reportableError, setReportableError] = useState(false);

  async function importCredential() {
    setError(undefined);
    setReportableError(false);
    let input: unknown;
    try {
      input = JSON.parse(credentialText);
    } catch {
      setError('Paste the complete development credential JSON.');
      return;
    }

    const credential = parseDevelopmentCredential(input);
    if (!credential) {
      setError('Paste a valid local development credential.');
      return;
    }
    if (credential.session.role !== 'PARENT') {
      setError('Use a parent development credential.');
      return;
    }

    setSaving(true);
    try {
      await sessionStore.save(credential.session);
      onComplete();
    } catch {
      setError('The credential could not be saved securely.');
      setReportableError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.eyebrow}>LOCAL DEVELOPMENT</Text>
        <Text style={styles.title}>Connect the parent app</Text>
        <Text style={styles.instructions}>
          Paste a parent credential from .local/dev-fixtures on your trusted
          development network.
        </Text>
        <TextInput
          accessibilityLabel="Credential JSON"
          testID="family-app-development-credential-import"
          value={credentialText}
          onChangeText={setCredentialText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          placeholder="Paste credential JSON"
          placeholderTextColor={familyTokens.color.mutedInk}
          style={styles.input}
        />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {error && reportableError && onReportProblem ? (
          <ScreenStateAction
            label="Report this problem"
            onPress={() =>
              onReportProblem({ category: 'BROKEN', screen: 'SETUP' })
            }
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void importCredential()}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            saving && styles.buttonDisabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={familyTokens.color.surface} />
          ) : (
            <Text style={styles.buttonLabel}>Import parent credentials</Text>
          )}
        </Pressable>
      </View>
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: familyTokens.space.lg,
    padding: familyTokens.space.lg,
    backgroundColor: familyTokens.color.canvas,
  },
  card: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.large,
    backgroundColor: familyTokens.color.surface,
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
  instructions: {
    color: familyTokens.color.mutedInk,
    fontSize: 16,
    lineHeight: 23,
  },
  input: {
    minHeight: 160,
    padding: familyTokens.space.md,
    borderWidth: 2,
    borderColor: '#D8D0C4',
    borderRadius: familyTokens.radius.small,
    color: familyTokens.color.ink,
    fontFamily: 'monospace',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  error: {
    color: familyTokens.color.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.pill,
    paddingHorizontal: familyTokens.space.lg,
    backgroundColor: familyTokens.color.focus,
  },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.55 },
  buttonLabel: {
    color: familyTokens.color.surface,
    fontSize: 16,
    fontWeight: '700',
  },
});
