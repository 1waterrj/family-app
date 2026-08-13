import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { useMaintainerToolsSetting } from '../../src/features/feedback/maintainer-settings';
import { FeedbackDetailScreen } from '../../src/screens/feedback-detail-screen';

export default function FeedbackDetailRoute() {
  const { session, fetch } = useSession();
  const parameters = useLocalSearchParams<{ feedbackId?: string }>();
  const router = useRouter();
  const maintainerTools = useMaintainerToolsSetting(AsyncStorage);
  useRecordFeedbackScreen('PARENT_FEEDBACK_DETAIL');

  if (!session) return <Redirect href="/setup" />;
  if (typeof parameters.feedbackId !== 'string') {
    return <Redirect href="/(tabs)/feedback" />;
  }
  return (
    <FeedbackDetailScreen
      feedbackId={parameters.feedbackId}
      session={session}
      fetch={fetch}
      maintainerToolsEnabled={
        !maintainerTools.loading && maintainerTools.enabled
      }
      onDeleted={() => router.replace('/(tabs)/feedback')}
      onPreparePublicIssue={(feedbackId) =>
        router.push({
          pathname: '/feedback/export/[feedbackId]',
          params: { feedbackId },
        })
      }
    />
  );
}
