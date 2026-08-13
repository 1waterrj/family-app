import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '../src/auth/use-session';
import { familyTokens } from '@family/design-tokens';
import { FeedbackQueueStatus } from '../src/components/feedback-queue-status';
import { useOpenFeedbackDraft } from '../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../src/features/feedback/feedback-runtime';

declare const require: (
  path: '../src/screens/setup-screen',
) => typeof import('../src/screens/setup-screen');

export default function SetupRoute() {
  const router = useRouter();
  const { sessionStore, refreshSession } = useSession();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('SETUP');

  if (__DEV__) {
    const { SetupScreen } = require('../src/screens/setup-screen');
    return (
      <SetupScreen
        sessionStore={sessionStore}
        onReportProblem={openFeedbackDraft}
        footer={<FeedbackQueueStatus />}
        onComplete={() => {
          void refreshSession().then(() => router.replace('/(tabs)/home'));
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Production sign-in is not configured</Text>
      <Text style={styles.message}>
        This build cannot import local development credentials.
      </Text>
    </View>
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
  title: {
    color: familyTokens.color.ink,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: familyTokens.color.mutedInk,
    fontSize: 16,
    textAlign: 'center',
  },
});
