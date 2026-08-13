import AsyncStorage from '@react-native-async-storage/async-storage';
import { familyTokens } from '@family/design-tokens';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useSession } from '../../src/auth/use-session';
import { FeedbackQueueStatus } from '../../src/components/feedback-queue-status';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { useMaintainerToolsSetting } from '../../src/features/feedback/maintainer-settings';
import { FeedbackInboxScreen } from '../../src/screens/feedback-inbox-screen';

export default function FeedbackRoute() {
  const { session, fetch } = useSession();
  const router = useRouter();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const maintainerTools = useMaintainerToolsSetting(AsyncStorage);
  useRecordFeedbackScreen('PARENT_FEEDBACK');

  if (!session) return <Redirect href="/setup" />;

  const header = (
    <>
      <View style={styles.headingGroup}>
        <Text style={styles.eyebrow}>YOUR VOICE</Text>
        <Text style={styles.title}>Feedback</Text>
        <Text style={styles.intro}>
          Tell us what broke, what felt confusing, or what could be better.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/feedback/new')}
        style={({ pressed }) => [styles.sendCard, pressed && styles.pressed]}
      >
        <View style={styles.sendCopy}>
          <Text style={styles.sendTitle}>Send feedback</Text>
          <Text style={styles.sendSummary}>
            It takes one choice. Details are optional.
          </Text>
        </View>
        <Text accessibilityElementsHidden style={styles.chevron}>
          ›
        </Text>
      </Pressable>

      <FeedbackQueueStatus />

      <View style={styles.advancedCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          onPress={() => setAdvancedOpen((open) => !open)}
          style={({ pressed }) => [
            styles.advancedHeader,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.advancedTitle}>Advanced</Text>
          <Text accessibilityElementsHidden style={styles.chevron}>
            {advancedOpen ? '⌃' : '⌄'}
          </Text>
        </Pressable>
        {advancedOpen ? (
          <View style={styles.advancedBody}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>Maintainer tools</Text>
              <Text style={styles.switchSummary}>
                Allow a reviewed draft to open GitHub on this phone. No GitHub
                credential is stored in Family.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Enable maintainer tools on this phone"
              accessibilityState={{
                checked: maintainerTools.enabled,
                disabled: maintainerTools.loading || maintainerTools.saving,
              }}
              disabled={maintainerTools.loading || maintainerTools.saving}
              onValueChange={(enabled) =>
                void maintainerTools.setEnabled(enabled)
              }
              value={maintainerTools.enabled}
            />
            {maintainerTools.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {maintainerTools.error}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );

  return (
    <FeedbackInboxScreen
      session={session}
      fetch={fetch}
      onOpen={(feedbackId) =>
        router.push({
          pathname: '/feedback/[feedbackId]',
          params: { feedbackId },
        })
      }
      header={header}
    />
  );
}

const styles = StyleSheet.create({
  headingGroup: { gap: familyTokens.space.sm },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 32, fontWeight: '800' },
  intro: { color: familyTokens.color.mutedInk, fontSize: 16, lineHeight: 23 },
  sendCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.large,
    backgroundColor: familyTokens.color.surface,
  },
  sendCopy: { flex: 1, gap: familyTokens.space.xs },
  sendTitle: { color: familyTokens.color.ink, fontSize: 20, fontWeight: '800' },
  sendSummary: { color: familyTokens.color.mutedInk, fontSize: 15 },
  chevron: { color: familyTokens.color.focus, fontSize: 30 },
  advancedCard: {
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
    overflow: 'hidden',
  },
  advancedHeader: {
    minHeight: familyTokens.touch.phoneMinimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: familyTokens.space.lg,
  },
  advancedTitle: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  advancedBody: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    paddingTop: 0,
  },
  switchCopy: { flex: 1, minWidth: 220, gap: familyTokens.space.xs },
  switchTitle: { color: familyTokens.color.ink, fontWeight: '700' },
  switchSummary: {
    color: familyTokens.color.mutedInk,
    fontSize: 14,
    lineHeight: 20,
  },
  error: { width: '100%', color: familyTokens.color.danger, fontWeight: '700' },
  pressed: { opacity: 0.78 },
});
