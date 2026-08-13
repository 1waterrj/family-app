import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useSession } from '../../../src/auth/use-session';
import { ScreenState } from '../../../src/components/screen-state';
import { useRecordFeedbackScreen } from '../../../src/features/feedback/feedback-runtime';
import { useMaintainerToolsSetting } from '../../../src/features/feedback/maintainer-settings';
import { FeedbackExportScreen } from '../../../src/screens/feedback-export-screen';

export default function FeedbackExportRoute() {
  const { session, fetch } = useSession();
  const parameters = useLocalSearchParams<{ feedbackId?: string }>();
  const maintainerTools = useMaintainerToolsSetting(AsyncStorage);
  useRecordFeedbackScreen('PARENT_FEEDBACK_EXPORT');

  if (!session) return <Redirect href="/setup" />;
  if (typeof parameters.feedbackId !== 'string') {
    return <Redirect href="/(tabs)/feedback" />;
  }
  if (maintainerTools.loading) {
    return <ScreenState message="Checking maintainer tools…" />;
  }
  return (
    <FeedbackExportScreen
      feedbackId={parameters.feedbackId}
      session={session}
      fetch={fetch}
      maintainerToolsEnabled={maintainerTools.enabled}
    />
  );
}
