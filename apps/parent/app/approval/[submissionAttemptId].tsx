import { Redirect, useLocalSearchParams } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import { useOpenFeedbackDraft } from '../../src/features/feedback/contextual-feedback';
import { useRecordFeedbackScreen } from '../../src/features/feedback/feedback-runtime';
import { ApprovalDetailScreen } from '../../src/screens/approval-detail-screen';

export default function ApprovalDetailRoute() {
  const { session, fetch } = useSession();
  const parameters = useLocalSearchParams<{ submissionAttemptId?: string }>();
  const openFeedbackDraft = useOpenFeedbackDraft();
  useRecordFeedbackScreen('PARENT_APPROVALS');
  if (!session) return <Redirect href="/setup" />;
  if (typeof parameters.submissionAttemptId !== 'string') {
    return <Redirect href="/(tabs)/approvals" />;
  }
  return (
    <ApprovalDetailScreen
      submissionAttemptId={parameters.submissionAttemptId}
      session={session}
      fetch={fetch}
      onReportProblem={openFeedbackDraft}
    />
  );
}
