import dishesImage from '@family/chore-images/assets/dishes.png';
import feedPetImage from '@family/chore-images/assets/feed-pet.png';
import helpGardenImage from '@family/chore-images/assets/help-garden.png';
import laundryImage from '@family/chore-images/assets/laundry.png';
import makeBedImage from '@family/chore-images/assets/make-bed.png';
import setTableImage from '@family/chore-images/assets/set-table.png';
import tidyToysImage from '@family/chore-images/assets/tidy-toys.png';
import wipeCounterImage from '@family/chore-images/assets/wipe-counter.png';
import type { ChoreImageKey } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const sources: Record<ChoreImageKey, ImageSourcePropType> = {
  'tidy-toys': tidyToysImage,
  dishes: dishesImage,
  'set-table': setTableImage,
  laundry: laundryImage,
  'feed-pet': feedPetImage,
  'make-bed': makeBedImage,
  'wipe-counter': wipeCounterImage,
  'help-garden': helpGardenImage,
};

export function ChoreImage({
  imageKey,
  label,
  size = 72,
}: {
  imageKey: ChoreImageKey | null;
  label: string;
  size?: number;
}) {
  if (!imageKey) {
    return (
      <View
        accessibilityLabel={`${label} chore picture unavailable`}
        accessibilityRole="image"
        style={[styles.placeholder, { width: size, height: size }]}
      >
        <Text style={styles.placeholderText}>○</Text>
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel={`${label} chore picture`}
      accessibilityRole="image"
      source={sources[imageKey]}
      style={{ width: size, height: size, borderRadius: size / 4 }}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: familyTokens.radius.medium,
    backgroundColor: '#F4E6C8',
  },
  placeholderText: {
    color: familyTokens.color.warning,
    fontSize: 28,
    fontWeight: '800',
  },
});
