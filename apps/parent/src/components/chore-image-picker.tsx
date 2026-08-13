import { choreImageCatalog } from '@family/chore-images';
import type { ChoreImageKey } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChoreImage } from './chore-image';

export function ChoreImagePicker({
  value,
  disabled = false,
  onChange,
}: {
  value: ChoreImageKey;
  disabled?: boolean;
  onChange(value: ChoreImageKey): void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.grid}>
      {choreImageCatalog.map((picture) => {
        const selected = value === picture.key;
        return (
          <Pressable
            key={picture.key}
            accessibilityLabel={`Choose ${picture.label} picture`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            onPress={() => onChange(picture.key)}
            style={[styles.option, selected && styles.selected]}
          >
            <ChoreImage
              imageKey={picture.key}
              label={picture.label}
              size={56}
            />
            <Text style={styles.label}>{picture.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: familyTokens.space.sm,
  },
  option: {
    width: '48%',
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.sm,
    padding: familyTokens.space.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
  },
  selected: { borderColor: familyTokens.color.focus },
  label: {
    flex: 1,
    color: familyTokens.color.ink,
    fontSize: 14,
    fontWeight: '700',
  },
});
