import { Redirect, useRouter } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useOpenFeedbackDraft } from '../../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { ApprovalsScreen } from '../../src/screens/approvals-screen';

export default function ApprovalsRoute() {
  const { session, fetch } = useSession();
  const router = useRouter();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('PARENT_APPROVALS');
  if (!session) return <Redirect href="/setup" />;
  return (
    <ApprovalsScreen
      session={session}
      fetch={fetch}
      onReportProblem={openFeedbackDraft}
      onReview={(submissionAttemptId) =>
        router.push({
          pathname: '/approval/[submissionAttemptId]',
          params: { submissionAttemptId },
        })
      }
    />
  );
}
