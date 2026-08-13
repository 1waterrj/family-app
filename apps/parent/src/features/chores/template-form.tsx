import type { ChoreImageKey } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoreImagePicker } from '../../components/chore-image-picker';

export type TemplateDraft = {
  name: string;
  imageKey: ChoreImageKey;
  instructions: string;
  valueInput: string;
  durationMinutesInput: string;
};

export function TemplateForm({
  draft,
  disabled,
  draftFrozen,
  error,
  onChange,
  onStartNewOperation,
  onSubmit,
}: {
  draft: TemplateDraft;
  disabled: boolean;
  draftFrozen: boolean;
  error?: string;
  onChange(change: Partial<TemplateDraft>): void;
  onStartNewOperation(): void;
  onSubmit(): void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Create a reusable chore</Text>
      <Field
        label="Chore name"
        value={draft.name}
        disabled={disabled || draftFrozen}
        onChangeText={(name) => onChange({ name })}
      />
      <Text style={styles.label}>Picture</Text>
      <ChoreImagePicker
        value={draft.imageKey}
        disabled={disabled || draftFrozen}
        onChange={(imageKey) => onChange({ imageKey })}
      />
      <Field
        label="Chore instructions"
        value={draft.instructions}
        disabled={disabled || draftFrozen}
        multiline
        onChangeText={(instructions) => onChange({ instructions })}
      />
      <Field
        label="Default reward"
        value={draft.valueInput}
        disabled={disabled || draftFrozen}
        inputMode="decimal"
        onChangeText={(valueInput) => onChange({ valueInput })}
      />
      <Field
        label="Default duration"
        value={draft.durationMinutesInput}
        disabled={disabled || draftFrozen}
        inputMode="numeric"
        onChangeText={(durationMinutesInput) =>
          onChange({ durationMinutesInput })
        }
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {draftFrozen ? (
        <>
          <Text style={styles.locked}>
            This submitted draft is locked. Retry it exactly or start a new
            operation to edit it.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start new template operation"
            disabled={disabled}
            onPress={onStartNewOperation}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Start new operation</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create template"
        disabled={disabled}
        onPress={onSubmit}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Create template</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  value,
  disabled,
  multiline = false,
  inputMode,
  onChangeText,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  inputMode?: 'decimal' | 'numeric';
  onChangeText(value: string): void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        inputMode={inputMode}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.textArea]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  heading: { color: familyTokens.color.ink, fontSize: 22, fontWeight: '800' },
  field: { gap: familyTokens.space.sm },
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
  textArea: { minHeight: 84, textAlignVertical: 'top' },
  error: { color: familyTokens.color.danger, fontSize: 15 },
  locked: { color: familyTokens.color.warning, fontSize: 15 },
  secondaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.small,
  },
  secondaryButtonText: {
    color: familyTokens.color.focus,
    fontSize: 16,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.focus,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
