import { formatCents } from '@family/api-client';
import dishesImage from '@family/chore-images/assets/dishes.png';
import feedPetImage from '@family/chore-images/assets/feed-pet.png';
import helpGardenImage from '@family/chore-images/assets/help-garden.png';
import laundryImage from '@family/chore-images/assets/laundry.png';
import makeBedImage from '@family/chore-images/assets/make-bed.png';
import setTableImage from '@family/chore-images/assets/set-table.png';
import tidyToysImage from '@family/chore-images/assets/tidy-toys.png';
import wipeCounterImage from '@family/chore-images/assets/wipe-counter.png';
import type { ChoreImageKey, ParentSnapshot } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

type PendingApproval = ParentSnapshot['pendingApprovals'][number];

const imageSources: Record<ChoreImageKey, ImageSourcePropType> = {
  'tidy-toys': tidyToysImage,
  dishes: dishesImage,
  'set-table': setTableImage,
  laundry: laundryImage,
  'feed-pet': feedPetImage,
  'make-bed': makeBedImage,
  'wipe-counter': wipeCounterImage,
  'help-garden': helpGardenImage,
};

export function ApprovalCard({
  approval,
  timeZone,
  onReview,
}: {
  approval: PendingApproval;
  timeZone: string;
  onReview(submissionAttemptId: string): void;
}) {
  const { chore, child } = approval;
  const imageSource = chore.imageUrl
    ? { uri: chore.imageUrl }
    : chore.imageKey
      ? imageSources[chore.imageKey]
      : undefined;
  const elapsed = completionElapsedLabel(
    approval.claimedAt,
    approval.submittedAt,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${chore.name} for ${child.name}`}
      onPress={() => onReview(approval.submissionAttemptId)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {imageSource ? (
        <Image
          accessibilityLabel={`${chore.name} chore picture`}
          source={imageSource}
          style={styles.picture}
        />
      ) : (
        <View
          accessibilityLabel={`${chore.name} chore picture`}
          style={[styles.picture, styles.pictureFallback]}
        >
          <Text style={styles.pictureFallbackSymbol}>✓</Text>
        </View>
      )}
      <View style={styles.copy}>
        <Text style={styles.choreName}>{chore.name}</Text>
        <Text style={styles.childName}>{child.name}</Text>
        <Text style={styles.meta}>
          Proposed reward {formatCents(chore.valueCents, 'en-US')}
        </Text>
        <Text style={styles.meta}>
          Submitted {formatSubmittedAt(approval.submittedAt, timeZone)}
        </Text>
        {elapsed ? <Text style={styles.meta}>{elapsed}</Text> : null}
      </View>
      <Text accessibilityElementsHidden style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

function completionElapsedLabel(
  claimedAt: string | null,
  submittedAt: string,
): string | null {
  if (claimedAt === null) return null;
  const elapsedMilliseconds =
    new Date(submittedAt).getTime() - new Date(claimedAt).getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMilliseconds / 60_000));
  return `Completed in ${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'}`;
}

function formatSubmittedAt(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

const styles = StyleSheet.create({
  card: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  pressed: { opacity: 0.72 },
  picture: {
    width: 76,
    height: 76,
    borderRadius: familyTokens.radius.small,
  },
  pictureFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4E6C8',
  },
  pictureFallbackSymbol: {
    color: familyTokens.color.warning,
    fontSize: 28,
    fontWeight: '800',
  },
  copy: { flex: 1, gap: familyTokens.space.xs },
  choreName: {
    color: familyTokens.color.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  childName: {
    color: familyTokens.color.child.secondary,
    fontSize: 16,
    fontWeight: '700',
  },
  meta: { color: familyTokens.color.mutedInk, fontSize: 14 },
  chevron: { color: familyTokens.color.focus, fontSize: 32 },
});
