import { familyTokens } from '@family/design-tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ScreenState({
  message,
  primaryActionLabel,
  onPrimaryAction,
  actionLabel,
  onAction,
}: {
  message: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.message}>{message}</Text>
      {primaryActionLabel && onPrimaryAction ? (
        <ScreenStateAction
          label={primaryActionLabel}
          onPress={onPrimaryAction}
          variant="primary"
        />
      ) : null}
      {actionLabel && onAction ? (
        <ScreenStateAction label={actionLabel} onPress={onAction} />
      ) : null}
    </View>
  );
}

export function ScreenStateAction({
  label,
  onPress,
  variant = 'secondary',
}: {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        variant === 'primary' && styles.primaryAction,
        pressed && styles.actionPressed,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          variant === 'primary' && styles.primaryActionLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    backgroundColor: familyTokens.color.canvas,
  },
  message: {
    color: familyTokens.color.mutedInk,
    fontSize: 18,
    textAlign: 'center',
  },
  action: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.lg,
    borderWidth: 2,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.pill,
    backgroundColor: familyTokens.color.surface,
  },
  actionPressed: { opacity: 0.72 },
  primaryAction: {
    backgroundColor: familyTokens.color.focus,
  },
  actionLabel: {
    color: familyTokens.color.focus,
    fontSize: 16,
    fontWeight: '800',
  },
  primaryActionLabel: { color: familyTokens.color.surface },
});
