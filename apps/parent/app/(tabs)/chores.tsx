import { Redirect } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useOpenFeedbackDraft } from '../../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { ChoresScreen } from '../../src/screens/chores-screen';

export default function ChoresRoute() {
  const { session, fetch } = useSession();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('PARENT_CHORES');
  if (!session) return <Redirect href="/setup" />;
  return (
    <ChoresScreen
      session={session}
      fetch={fetch}
      onReportProblem={openFeedbackDraft}
    />
  );
}
