import type { ManualLedgerTransactionType } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type LedgerEntryDraft = {
  childId: string;
  kind: 'PURCHASE' | 'MANUAL_CREDIT' | 'CORRECTION';
  amountInput: string;
  note: string;
};

const kinds: ReadonlyArray<{
  kind: ManualLedgerTransactionType;
  label: string;
}> = [
  { kind: 'PURCHASE', label: 'Purchase' },
  { kind: 'MANUAL_CREDIT', label: 'Manual credit' },
  { kind: 'CORRECTION', label: 'Correction' },
];

export function LedgerEntryForm({
  draft,
  disabled,
  draftFrozen,
  error,
  success,
  onChange,
  onStartNewOperation,
  onSubmit,
}: {
  draft: LedgerEntryDraft;
  disabled: boolean;
  draftFrozen: boolean;
  error?: string;
  success?: string;
  onChange(change: Partial<LedgerEntryDraft>): void;
  onStartNewOperation(): void;
  onSubmit(): void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Adjust balance</Text>
      <View accessibilityRole="radiogroup" style={styles.kindRow}>
        {kinds.map((option) => (
          <Pressable
            key={option.kind}
            accessibilityLabel={option.label}
            accessibilityRole="button"
            accessibilityState={{
              disabled: disabled || draftFrozen,
              selected: draft.kind === option.kind,
            }}
            disabled={disabled || draftFrozen}
            onPress={() => onChange({ kind: option.kind })}
            style={[
              styles.kindButton,
              draft.kind === option.kind && styles.selectedKind,
            ]}
          >
            <Text style={styles.kindLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Amount</Text>
        <TextInput
          accessibilityLabel="Ledger amount"
          editable={!disabled && !draftFrozen}
          inputMode="decimal"
          onChangeText={(amountInput) => onChange({ amountInput })}
          placeholder={draft.kind === 'CORRECTION' ? '+1.00 or -1.00' : '1.00'}
          style={styles.input}
          value={draft.amountInput}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Note</Text>
        <TextInput
          accessibilityLabel="Ledger note"
          editable={!disabled && !draftFrozen}
          onChangeText={(note) => onChange({ note })}
          placeholder="What was this for?"
          style={styles.input}
          value={draft.note}
        />
      </View>
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
            accessibilityLabel="Start new ledger operation"
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
        accessibilityLabel="Save ledger entry"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onSubmit}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Save ledger entry</Text>
      </Pressable>
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
  kindRow: { flexDirection: 'row', gap: familyTokens.space.sm },
  kindButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: familyTokens.space.sm,
    borderWidth: 2,
    borderColor: '#E3E7E9',
    borderRadius: familyTokens.radius.small,
  },
  selectedKind: { borderColor: familyTokens.color.focus },
  kindLabel: {
    color: familyTokens.color.ink,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
