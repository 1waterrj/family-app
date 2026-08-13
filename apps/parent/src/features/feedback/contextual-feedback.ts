import { FeedbackScreenSchema, type FeedbackScreen } from '@family/contracts';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

export type ParentReportProblemScreen = Extract<
  FeedbackScreen,
  | 'SETUP'
  | 'PARENT_HOME'
  | 'PARENT_APPROVALS'
  | 'PARENT_CHORES'
  | 'PARENT_REWARDS'
>;

export type ReportProblemContext = Readonly<{
  category: 'BROKEN';
  screen: ParentReportProblemScreen;
}>;

export type OpenFeedbackDraft = (context: ReportProblemContext) => void;

export function useOpenFeedbackDraft(): OpenFeedbackDraft {
  const router = useRouter();
  return useCallback(
    (context: ReportProblemContext) => {
      router.push({
        pathname: '/feedback/new',
        params: context,
      });
    },
    [router],
  );
}

export function parseReportProblemContext(parameters: {
  category?: unknown;
  screen?: unknown;
}): ReportProblemContext | undefined {
  if (parameters.category !== 'BROKEN') return undefined;
  const screen = FeedbackScreenSchema.safeParse(parameters.screen);
  return screen.success && isParentReportProblemScreen(screen.data)
    ? { category: 'BROKEN', screen: screen.data }
    : undefined;
}

export function canOpenReportProblemBeforeAuthentication(
  context: ReportProblemContext | undefined,
): boolean {
  return context?.screen === 'SETUP';
}

function isParentReportProblemScreen(
  screen: FeedbackScreen,
): screen is ParentReportProblemScreen {
  return (
    screen === 'SETUP' ||
    screen === 'PARENT_HOME' ||
    screen === 'PARENT_APPROVALS' ||
    screen === 'PARENT_CHORES' ||
    screen === 'PARENT_REWARDS'
  );
}
