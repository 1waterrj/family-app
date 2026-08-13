import { familyTokens } from '@family/design-tokens';
import { StyleSheet, Text, TextInput, View } from 'react-native';

export function MoneyInput({
  value,
  onChangeText,
  editable = true,
}: {
  value: string;
  onChangeText(value: string): void;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Reward amount</Text>
      <View style={styles.inputRow}>
        <Text style={styles.currency}>$</Text>
        <TextInput
          accessibilityLabel="Reward amount"
          editable={editable}
          inputMode="decimal"
          onChangeText={onChangeText}
          selectTextOnFocus
          style={styles.input}
          value={value}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: familyTokens.space.sm },
  label: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  inputRow: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C7CED1',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
  },
  currency: {
    paddingLeft: familyTokens.space.md,
    color: familyTokens.color.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    padding: familyTokens.space.md,
    color: familyTokens.color.ink,
    fontSize: 20,
  },
});
