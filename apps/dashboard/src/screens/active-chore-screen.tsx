import { formatCents } from '@family/api-client';
import type {
  ChoreSubmissionResult,
  DashboardChore,
  DashboardSnapshot,
  SubmitChore,
} from '@family/contracts';
import { useEffect, useRef, useState } from 'react';

import { ChorePicture } from '../components/chore-picture';
import { ConfirmAction } from '../components/confirm-action';
import { remainingSeconds } from '../features/chores/countdown';
import {
  isCancelledChoreOperation,
  useChoreOperation,
} from '../features/chores/use-chore-operation';
import {
  isActiveChoreStateRace,
  isReportableDashboardFailure,
  reportProblemContext,
  type OpenFeedbackDraft,
} from '../features/feedback/contextual-feedback';

type SnapshotChild = DashboardSnapshot['children'][number];

export function ActiveChoreScreen({
  chore,
  child,
  serverOffsetMs,
  now = Date.now,
  submit,
  createId,
  isOnline = true,
  isConnectivityPaused = false,
  onSubmitted,
  onBack,
  onRefresh,
  onReportProblem,
}: {
  chore: DashboardChore;
  child: SnapshotChild;
  serverOffsetMs: number;
  now?: () => number;
  submit: (input: SubmitChore) => Promise<ChoreSubmissionResult>;
  createId?: () => string;
  isOnline?: boolean;
  isConnectivityPaused?: boolean;
  onSubmitted: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const [clientNow, setClientNow] = useState(now);
  const [confirming, setConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();
  const [isErrorReportable, setIsErrorReportable] = useState(false);
  const [submittedLocally, setSubmittedLocally] = useState(false);
  const refreshedDeadlineRef = useRef<string | undefined>(undefined);
  const operation = useChoreOperation(
    (input: Omit<SubmitChore, 'idempotencyKey'>, idempotencyKey) =>
      submit({ ...input, idempotencyKey }),
    createId,
  );

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(now()), 1_000);
    return () => window.clearInterval(interval);
  }, [now]);

  const seconds =
    chore.status === 'CLAIMED' && chore.claimDeadlineAt
      ? remainingSeconds(chore.claimDeadlineAt, clientNow, serverOffsetMs)
      : undefined;

  useEffect(() => {
    if (
      chore.status === 'CLAIMED' &&
      chore.claimDeadlineAt &&
      seconds === 0 &&
      refreshedDeadlineRef.current !== chore.claimDeadlineAt
    ) {
      refreshedDeadlineRef.current = chore.claimDeadlineAt;
      onRefresh();
    }
  }, [chore.claimDeadlineAt, chore.status, onRefresh, seconds]);

  function openConfirmation() {
    operation.begin();
    setError(undefined);
    setIsErrorReportable(false);
    setConfirming(true);
  }

  function cancelConfirmation() {
    operation.cancel();
    setConfirming(false);
    setError(undefined);
    setIsErrorReportable(false);
    setIsPending(false);
  }

  async function confirmSubmission() {
    const current = operation.operation;
    if (!current || !isOnline || isConnectivityPaused) return;
    setIsPending(true);
    setError(undefined);
    setIsErrorReportable(false);
    try {
      await current.execute({
        choreInstanceId: chore.id,
        childId: child.profile.id,
      });
      if (!operation.complete(current)) return;
      setSubmittedLocally(true);
      setConfirming(false);
      onRefresh();
      onSubmitted();
    } catch (caught) {
      if (isCancelledChoreOperation(caught) || !operation.isCurrent(current)) {
        return;
      }
      if (isActiveChoreStateRace(caught)) {
        setError(
          'This chore changed on the family server. Try again after it refreshes.',
        );
        setIsErrorReportable(false);
        onRefresh();
      } else {
        setError('Could not reach the family server. Try again.');
        setIsErrorReportable(isReportableDashboardFailure(caught));
      }
    } finally {
      if (operation.isCurrent(current)) setIsPending(false);
    }
  }

  const isOwner = chore.claimedChildId === child.profile.id;
  const waiting = submittedLocally || chore.status === 'AWAITING_APPROVAL';

  return (
    <main className="chore-flow-screen">
      <button type="button" className="secondary-action" onClick={onBack}>
        Home
      </button>
      <article className="active-chore flow-card">
        <ChorePicture chore={chore} className="chore-detail-picture" />
        <p className="eyebrow">{child.profile.name.toUpperCase()}'S CHORE</p>
        <h1>{chore.name}</h1>
        <p>{chore.instructions}</p>
        <strong>{formatCents(chore.valueCents, 'en-US')}</strong>
        {waiting ? (
          <p className="waiting-state" role="status">
            Waiting for a grown-up.
          </p>
        ) : null}
        {!waiting && seconds !== undefined ? (
          <p className="countdown" role="timer">
            {seconds === 0
              ? 'Checking with the family server…'
              : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
          </p>
        ) : null}
        {!waiting && isOwner && chore.status === 'CLAIMED' && !confirming ? (
          <button
            type="button"
            className="primary-action"
            onClick={openConfirmation}
          >
            I'm done
          </button>
        ) : null}
        {!waiting && isOwner && confirming ? (
          <ConfirmAction
            prompt="Tell a grown-up this chore is finished?"
            confirmLabel="Yes, I finished"
            isPending={isPending}
            disabled={!isOnline || isConnectivityPaused}
            error={error}
            onReportProblem={
              onReportProblem && isErrorReportable
                ? () =>
                    onReportProblem(
                      reportProblemContext('DASHBOARD_ACTIVE_CHORE'),
                    )
                : undefined
            }
            onConfirm={() => void confirmSubmission()}
            onCancel={cancelConfirmation}
          />
        ) : null}
      </article>
    </main>
  );
}
