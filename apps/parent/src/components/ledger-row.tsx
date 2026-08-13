import { formatCents } from '@family/api-client';
import type { LedgerTransaction } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { StyleSheet, Text, View } from 'react-native';

const typeLabels = {
  CHORE_CREDIT: 'chore credit',
  PURCHASE: 'purchase',
  MANUAL_CREDIT: 'manual credit',
  CORRECTION: 'correction',
} as const;

export function LedgerRow({
  transaction,
  timeZone,
}: {
  transaction: LedgerTransaction;
  timeZone: string;
}) {
  const sign = transaction.amountCents >= 0 ? 'plus' : 'minus';
  const amount = formatCents(Math.abs(transaction.amountCents), 'en-US');
  return (
    <View
      accessibilityLabel={`${transaction.note ?? typeLabels[transaction.type]}, ${typeLabels[transaction.type]}, ${sign} ${amount}`}
      testID="ledger-row"
      style={styles.row}
    >
      <View style={styles.copy}>
        <Text style={styles.note}>
          {transaction.note ?? typeLabels[transaction.type]}
        </Text>
        <Text style={styles.meta}>
          {new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone,
          }).format(new Date(transaction.createdAt))}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          transaction.amountCents >= 0 ? styles.credit : styles.debit,
        ]}
      >
        {transaction.amountCents >= 0 ? '+' : '−'}
        {amount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
    paddingVertical: familyTokens.space.md,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E7E9',
  },
  copy: { flex: 1 },
  note: { color: familyTokens.color.ink, fontSize: 16, fontWeight: '700' },
  meta: { color: familyTokens.color.mutedInk, fontSize: 13 },
  amount: { fontSize: 16, fontWeight: '800' },
  credit: { color: familyTokens.color.success },
  debit: { color: familyTokens.color.danger },
});
