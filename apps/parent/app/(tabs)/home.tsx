import { Redirect, useRouter } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useOpenFeedbackDraft } from '../../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { HomeScreen } from '../../src/screens/home-screen';

export default function HomeRoute() {
  const { session, fetch } = useSession();
  const router = useRouter();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('PARENT_HOME');
  if (!session) return <Redirect href="/setup" />;
  return (
    <HomeScreen
      session={session}
      fetch={fetch}
      onReportProblem={openFeedbackDraft}
      onOpenApprovals={() => router.push('/(tabs)/approvals')}
    />
  );
}
