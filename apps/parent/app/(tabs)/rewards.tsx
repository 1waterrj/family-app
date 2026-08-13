import { Redirect } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useOpenFeedbackDraft } from '../../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { RewardsScreen } from '../../src/screens/rewards-screen';

export default function RewardsRoute() {
  const { session, fetch } = useSession();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('PARENT_REWARDS');
  if (!session) return <Redirect href="/setup" />;
  return (
    <RewardsScreen
      session={session}
      fetch={fetch}
      onReportProblem={openFeedbackDraft}
    />
  );
}
