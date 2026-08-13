import type { ClientSession } from '@family/api-client';
import type { DashboardChore, DashboardSnapshot } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ChildCard } from '../components/child-card';
import { ConnectionStatus } from '../components/connection-status';
import { dashboardSnapshotQueryOptions } from '../query/dashboard-query';
import {
  isReportableDashboardFailure,
  reportProblemContext,
  type OpenFeedbackDraft,
} from '../features/feedback/contextual-feedback';

export function FamilyHomeScreen({
  session,
  fetch: fetchImpl,
  isOnline = navigator.onLine,
  now = () => new Date(),
  onOpenChoreBoard = () => undefined,
  onOpenActiveChore = () => undefined,
  onReportProblem,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  isOnline?: boolean;
  now?: () => Date;
  onOpenChoreBoard?: () => void;
  onOpenActiveChore?: (
    chore: DashboardChore,
    child: DashboardSnapshot['children'][number],
  ) => void;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const snapshotQuery = useQuery(
    dashboardSnapshotQueryOptions(session, fetchImpl),
  );
  return (
    <FamilyHomeView
      snapshot={snapshotQuery.data}
      isPending={snapshotQuery.isPending}
      isFetching={snapshotQuery.isFetching}
      dataUpdatedAt={snapshotQuery.dataUpdatedAt}
      isOnline={isOnline}
      now={now}
      onOpenChoreBoard={onOpenChoreBoard}
      onOpenActiveChore={onOpenActiveChore}
      onRetry={() => void snapshotQuery.refetch()}
      failure={snapshotQuery.error}
      onReportProblem={onReportProblem}
    />
  );
}

export function FamilyHomeView({
  snapshot,
  isPending,
  isFetching,
  dataUpdatedAt,
  isOnline,
  now = () => new Date(),
  onOpenChoreBoard = () => undefined,
  onOpenActiveChore = () => undefined,
  onRetry,
  failure,
  onReportProblem,
}: {
  snapshot?: DashboardSnapshot;
  isPending: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  isOnline: boolean;
  now?: () => Date;
  onOpenChoreBoard?: () => void;
  onOpenActiveChore?: (
    chore: DashboardChore,
    child: DashboardSnapshot['children'][number],
  ) => void;
  onRetry?: () => void;
  failure?: unknown;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const [clock, setClock] = useState(now);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(now()), 30_000);
    return () => window.clearInterval(interval);
  }, [now]);

  if (!snapshot && isPending) {
    return <main className="screen-state">Loading your family…</main>;
  }
  if (!snapshot) {
    return (
      <main className="screen-state">
        <p>
          {isOnline
            ? 'Family data could not be loaded. Try again in a moment.'
            : 'Connect to your family server to load this dashboard.'}
        </p>
        {onRetry ? (
          <button type="button" className="primary-action" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {onReportProblem && isReportableDashboardFailure(failure) ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              onReportProblem(reportProblemContext('DASHBOARD_HOME'))
            }
          >
            Report this problem
          </button>
        ) : null}
      </main>
    );
  }

  const availableCount = snapshot.chores.filter(
    ({ status }) => status === 'AVAILABLE',
  ).length;
  const showLastUpdated = !isOnline || isFetching;
  const formattedClock = formatClock(clock, snapshot.household.timeZone);
  const lastUpdated = formatClock(
    new Date(dataUpdatedAt),
    snapshot.household.timeZone,
  );

  return (
    <main className="family-home dashboard-feedback-safe-area">
      <header className="family-header">
        <div>
          <p className="eyebrow">FAMILY KITCHEN</p>
          <h1>{snapshot.household.name}</h1>
        </div>
        <time dateTime={clock.toISOString()}>{formattedClock}</time>
      </header>

      <div className="connection-row">
        <ConnectionStatus isOnline={isOnline} isRefreshing={isFetching} />
        {showLastUpdated ? <p>Last updated {lastUpdated}</p> : null}
      </div>

      <section className="child-grid" aria-label="Children">
        {snapshot.children.map((child) => {
          const activeChore = snapshot.chores.find(
            (chore) =>
              chore.claimedChildId === child.profile.id &&
              (chore.status === 'CLAIMED' ||
                chore.status === 'AWAITING_APPROVAL'),
          );
          return (
            <ChildCard
              key={child.profile.id}
              child={child}
              activeChore={activeChore}
              onOpenActiveChore={
                activeChore
                  ? () => onOpenActiveChore(activeChore, child)
                  : undefined
              }
            />
          );
        })}
      </section>

      <section className="chore-board-callout">
        <div>
          <p className="eyebrow">CHORE BOARD</p>
          <p className="pool-count">
            {availableCount} {availableCount === 1 ? 'chore' : 'chores'} ready
          </p>
        </div>
        <button
          type="button"
          className="primary-action chore-board-action"
          aria-label="Open Chore Board"
          onClick={onOpenChoreBoard}
          style={{
            minHeight: `${familyTokens.touch.dashboardMinimum}px`,
            minWidth: `${familyTokens.touch.dashboardMinimum}px`,
          }}
        >
          Chore Board <span aria-hidden="true">›</span>
        </button>
      </section>
    </main>
  );
}

function formatClock(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(value);
}
