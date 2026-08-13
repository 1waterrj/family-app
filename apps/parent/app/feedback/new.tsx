import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { useSession } from '../../src/auth/use-session';
import {
  canOpenReportProblemBeforeAuthentication,
  parseReportProblemContext,
} from '../../src/features/feedback/contextual-feedback';
import { SendFeedbackScreen } from '../../src/screens/send-feedback-screen';

export default function NewFeedbackRoute() {
  const { session } = useSession();
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    category?: string;
    screen?: string;
  }>();
  const context = parseReportProblemContext(parameters);

  if (!session && !canOpenReportProblemBeforeAuthentication(context)) {
    return <Redirect href="/setup" />;
  }
  return (
    <SendFeedbackScreen context={context} onCancel={() => router.back()} />
  );
}
