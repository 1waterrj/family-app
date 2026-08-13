import { FamilyApiError } from '@family/api-client';
import type { FeedbackScreen } from '@family/contracts';

export type DashboardReportProblemScreen = Extract<
  FeedbackScreen,
  | 'SETUP'
  | 'DASHBOARD_HOME'
  | 'DASHBOARD_CHORE_DETAIL'
  | 'DASHBOARD_ACTIVE_CHORE'
>;

export type ReportProblemContext = Readonly<{
  category: 'BROKEN';
  screen: DashboardReportProblemScreen;
}>;

export type OpenFeedbackDraft = (context: ReportProblemContext) => void;

export function reportProblemContext(
  screen: DashboardReportProblemScreen,
): ReportProblemContext {
  return { category: 'BROKEN', screen };
}

export function isReportableDashboardFailure(error: unknown): boolean {
  if (error === undefined || error === null) return false;
  if (!(error instanceof FamilyApiError)) return true;
  return (
    error.kind === 'OFFLINE' ||
    error.kind === 'UNAVAILABLE' ||
    error.kind === 'UNEXPECTED'
  );
}

export function isActiveChoreStateRace(error: unknown): boolean {
  return (
    error instanceof FamilyApiError &&
    error.kind === 'CONFLICT' &&
    error.code === 'INVALID_STATE'
  );
}
