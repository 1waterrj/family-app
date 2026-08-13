import type { ParentSnapshot } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { StyleSheet, Text, View } from 'react-native';

type SnapshotChild = ParentSnapshot['children'][number];
type SnapshotChore = ParentSnapshot['chores'][number];

export function ChildSummaryCard({
  child,
  activeChore,
}: {
  child: SnapshotChild;
  activeChore?: SnapshotChore;
}) {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.headingRow}>
        <Text style={styles.name}>{child.profile.name}</Text>
        <Text style={styles.balance}>{formatMoney(child.balanceCents)}</Text>
      </View>
      <Text style={styles.label}>Reward balance</Text>
      <Text style={styles.chore}>
        {activeChore ? activeChore.name : 'No chore in progress'}
      </Text>
    </View>
  );
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

const styles = StyleSheet.create({
  card: {
    gap: familyTokens.space.xs,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: familyTokens.space.md,
  },
  name: {
    color: familyTokens.color.ink,
    fontSize: 24,
    fontWeight: '700',
  },
  balance: {
    color: familyTokens.color.success,
    fontSize: 22,
    fontWeight: '700',
  },
  label: {
    color: familyTokens.color.mutedInk,
    fontSize: 13,
  },
  chore: {
    marginTop: familyTokens.space.sm,
    color: familyTokens.color.ink,
    fontSize: 17,
    fontWeight: '600',
  },
});
