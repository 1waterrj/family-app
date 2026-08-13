import { FamilyApiError, formatCents } from '@family/api-client';
import type {
  ClaimChore,
  ChoreInstance,
  DashboardChore,
  DashboardSnapshot,
} from '@family/contracts';
import { useState } from 'react';

import { ChildPicker } from '../components/child-picker';
import { ChorePicture } from '../components/chore-picture';
import { ConfirmAction } from '../components/confirm-action';
import {
  isCancelledChoreOperation,
  useChoreOperation,
} from '../features/chores/use-chore-operation';
import {
  isReportableDashboardFailure,
  reportProblemContext,
  type OpenFeedbackDraft,
} from '../features/feedback/contextual-feedback';

type SnapshotChild = DashboardSnapshot['children'][number];

export function ChoreDetailScreen({
  chore,
  children,
  claim,
  createId,
  isOnline,
  isConnectivityPaused,
  isClaimTransitionPending = false,
  onClaimed,
  onCancelClaimTransition,
  onBack,
  onRefresh,
  onReportProblem,
}: {
  chore: DashboardChore;
  children: DashboardSnapshot['children'];
  claim: (input: ClaimChore) => Promise<ChoreInstance>;
  createId?: () => string;
  isOnline: boolean;
  isConnectivityPaused: boolean;
  isClaimTransitionPending?: boolean;
  onClaimed: (childId: SnapshotChild['profile']['id']) => void | Promise<void>;
  onCancelClaimTransition?: () => void;
  onBack: () => void;
  onRefresh: () => void | Promise<void>;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const [step, setStep] = useState<'detail' | 'child' | 'confirm'>('detail');
  const [selectedChild, setSelectedChild] = useState<SnapshotChild>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();
  const [isErrorReportable, setIsErrorReportable] = useState(false);
  const operation = useChoreOperation(
    (input: Omit<ClaimChore, 'idempotencyKey'>, idempotencyKey) =>
      claim({ ...input, idempotencyKey }),
    createId,
  );

  function openConfirmation(child: SnapshotChild) {
    setSelectedChild(child);
    setError(undefined);
    setIsErrorReportable(false);
    operation.begin();
    setStep('confirm');
  }

  function cancelConfirmation() {
    operation.cancel();
    onCancelClaimTransition?.();
    setSelectedChild(undefined);
    setError(undefined);
    setIsErrorReportable(false);
    setIsPending(false);
    setStep('detail');
  }

  async function confirmClaim() {
    const child = selectedChild;
    const current = operation.operation;
    if (!child || !current || !isOnline || isConnectivityPaused) return;
    setIsPending(true);
    setError(undefined);
    setIsErrorReportable(false);
    try {
      await current.execute({
        choreInstanceId: chore.id,
        childId: child.profile.id,
      });
      if (!operation.isCurrent(current)) return;
      await onClaimed(child.profile.id);
      if (!operation.complete(current)) return;
      setStep('detail');
      setSelectedChild(undefined);
      setIsPending(false);
    } catch (caught) {
      if (isCancelledChoreOperation(caught) || !operation.isCurrent(current)) {
        return;
      }
      if (isUnavailableClaim(caught)) {
        setError('That chore was just claimed.');
        setIsErrorReportable(false);
        operation.complete(current);
        await onRefresh();
        onBack();
      } else {
        setError('Could not reach the family server. Try again.');
        setIsErrorReportable(isReportableDashboardFailure(caught));
      }
    } finally {
      if (operation.isCurrent(current)) setIsPending(false);
    }
  }

  if (step === 'child') {
    return (
      <main className="chore-flow-screen">
        <ChildPicker
          children={children}
          onSelect={openConfirmation}
          onCancel={() => setStep('detail')}
        />
      </main>
    );
  }

  if (step === 'confirm' && selectedChild) {
    return (
      <main className="chore-flow-screen">
        <ConfirmAction
          prompt={`${selectedChild.profile.name} will do ${chore.name}.`}
          confirmLabel="Yes, start it"
          isPending={isPending}
          disabled={!isOnline || isConnectivityPaused}
          error={error}
          onReportProblem={
            onReportProblem && isErrorReportable
              ? () =>
                  onReportProblem(
                    reportProblemContext('DASHBOARD_CHORE_DETAIL'),
                  )
              : undefined
          }
          onConfirm={() => void confirmClaim()}
          onCancel={cancelConfirmation}
        />
      </main>
    );
  }

  return (
    <main className="chore-flow-screen">
      <button type="button" className="secondary-action" onClick={onBack}>
        Chore Board
      </button>
      <article className="chore-detail flow-card">
        <ChorePicture chore={chore} className="chore-detail-picture" />
        <div>
          <p className="eyebrow">READY TO HELP?</p>
          <h1>{chore.name}</h1>
          <p>{chore.instructions}</p>
          <div className="chore-facts">
            <strong>{formatCents(chore.valueCents, 'en-US')}</strong>
            <strong>
              {chore.durationMinutes}{' '}
              {chore.durationMinutes === 1 ? 'minute' : 'minutes'}
            </strong>
          </div>
          <button
            type="button"
            className="primary-action"
            disabled={isClaimTransitionPending}
            onClick={() => setStep('child')}
          >
            Choose who
          </button>
        </div>
      </article>
    </main>
  );
}

function isUnavailableClaim(error: unknown): boolean {
  return (
    error instanceof FamilyApiError &&
    error.kind === 'CONFLICT' &&
    error.code === 'CHORE_UNAVAILABLE'
  );
}
