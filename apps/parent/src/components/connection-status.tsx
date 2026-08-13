import { familyTokens } from '@family/design-tokens';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function ConnectionStatus({
  isOnline,
  isRefreshing,
  isStale,
  hasData,
}: {
  isOnline: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  hasData: boolean;
}) {
  if (!isOnline && hasData) {
    return <StatusText message="Offline — showing saved data" />;
  }
  if (isRefreshing && hasData) {
    return <StatusText message="Updating family data…" />;
  }
  if (isStale && hasData) {
    return <StatusText message="Saved data — pull to refresh" />;
  }
  if (hasData) {
    return <StatusText message="Family data is up to date" />;
  }
  return null;
}

function StatusText({ message }: { message: string }) {
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    borderRadius: familyTokens.radius.pill,
    paddingHorizontal: familyTokens.space.md,
    paddingVertical: familyTokens.space.sm,
    backgroundColor: '#F1EEE8',
  },
  text: {
    color: familyTokens.color.mutedInk,
    fontSize: 14,
    fontWeight: '600',
  },
});
