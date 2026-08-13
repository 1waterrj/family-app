import type { ChoreTemplate } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoreImage } from '../../components/chore-image';

export type PublishDraft = {
  instructionsInput: string;
  valueInput: string;
  durationMinutesInput: string;
};

export function PublishForm({
  templates,
  selectedTemplateId,
  draft,
  disabled,
  draftFrozen,
  error,
  success,
  onSelect,
  onChange,
  onStartNewOperation,
  onSubmit,
}: {
  templates: ChoreTemplate[];
  selectedTemplateId?: string;
  draft: PublishDraft;
  disabled: boolean;
  draftFrozen: boolean;
  error?: string;
  success?: string;
  onSelect(templateId: string): void;
  onChange(change: Partial<PublishDraft>): void;
  onStartNewOperation(): void;
  onSubmit(): void;
}) {
  const selected = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Add to the shared pool</Text>
      {templates.length === 0 ? (
        <Text style={styles.muted}>Create a template first.</Text>
      ) : (
        templates.map((template) => (
          <Pressable
            key={template.id}
            accessibilityLabel={`Select ${template.name} template`}
            accessibilityRole="button"
            accessibilityState={{
              disabled: disabled || draftFrozen,
              selected: template.id === selectedTemplateId,
            }}
            disabled={disabled || draftFrozen}
            onPress={() => onSelect(template.id)}
            style={[
              styles.template,
              template.id === selectedTemplateId && styles.selected,
            ]}
          >
            <ChoreImage
              imageKey={template.imageKey}
              label={template.name}
              size={48}
            />
            <View style={styles.templateCopy}>
              <Text style={styles.templateName}>{template.name}</Text>
              <Text style={styles.muted}>
                ${(template.defaultValueCents / 100).toFixed(2)} ·{' '}
                {template.defaultDurationMinutes} min
              </Text>
            </View>
          </Pressable>
        ))
      )}
      {selected ? (
        <Text style={styles.selection}>
          {selected.name} is selected for publishing.
        </Text>
      ) : null}
      <PublishField
        label="Published instructions override"
        value={draft.instructionsInput}
        disabled={disabled || draftFrozen || !selected}
        onChangeText={(instructionsInput) => onChange({ instructionsInput })}
      />
      <PublishField
        label="Published reward override"
        value={draft.valueInput}
        disabled={disabled || draftFrozen || !selected}
        inputMode="decimal"
        onChangeText={(valueInput) => onChange({ valueInput })}
      />
      <PublishField
        label="Published duration override"
        value={draft.durationMinutesInput}
        disabled={disabled || draftFrozen || !selected}
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
      {success ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {success}
        </Text>
      ) : null}
      {draftFrozen ? (
        <>
          <Text style={styles.locked}>
            This submitted draft is locked. Retry it exactly or start a new
            operation to edit it.
          </Text>
          <Pressable
            accessibilityLabel="Start new publish operation"
            accessibilityRole="button"
            disabled={disabled}
            onPress={onStartNewOperation}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Start new operation</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        accessibilityLabel="Add to shared pool"
        accessibilityRole="button"
        disabled={disabled || !selected}
        onPress={onSubmit}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Add to shared pool</Text>
      </Pressable>
    </View>
  );
}

function PublishField({
  label,
  value,
  disabled,
  inputMode,
  onChangeText,
}: {
  label: string;
  value: string;
  disabled: boolean;
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
        onChangeText={onChangeText}
        placeholder="Use template default"
        style={styles.input}
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
  template: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.sm,
    borderWidth: 2,
    borderColor: '#E3E7E9',
    borderRadius: familyTokens.radius.small,
  },
  selected: { borderColor: familyTokens.color.focus },
  templateCopy: { flex: 1 },
  templateName: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  muted: { color: familyTokens.color.mutedInk, fontSize: 14 },
  selection: {
    color: familyTokens.color.success,
    fontSize: 15,
    fontWeight: '700',
  },
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
  success: {
    color: familyTokens.color.success,
    fontSize: 15,
    fontWeight: '700',
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
