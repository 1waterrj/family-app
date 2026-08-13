import {
  FamilyApiError,
  createFamilyApiClient,
  createSecureUuid,
  familyQueryKeys,
  formatCents,
  parseSignedDollars,
  parseUnsignedDollars,
  type ClientSession,
} from '@family/api-client';
import { ChildIdSchema, ManualLedgerEntrySchema } from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LedgerRow } from '../components/ledger-row';
import { ScreenState, ScreenStateAction } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';
import {
  LedgerEntryForm,
  type LedgerEntryDraft,
} from '../features/rewards/ledger-entry-form';
import { parentSnapshotQueryOptions } from '../query/parent-snapshot';

type LedgerDraftState = {
  draft: LedgerEntryDraft;
  idempotencyKey: string;
};

export function RewardsScreen({
  session,
  fetch: fetchImpl,
  onReportProblem,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(
    parentSnapshotQueryOptions(session, fetchImpl),
  );
  const [selectedChildId, setSelectedChildId] = useState<string>();
  const [draftState, setDraftState] = useState<LedgerDraftState>(() =>
    newLedgerDraft(''),
  );
  const [error, setError] = useState<string>();
  const [reportableError, setReportableError] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [draftFrozen, setDraftFrozen] = useState(false);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const ledgerQuery = useQuery({
    queryKey: familyQueryKeys.ledger(session, selectedChildId ?? 'unselected'),
    queryFn: () => {
      const childId = ChildIdSchema.parse(selectedChildId);
      return createFamilyApiClient({
        apiOrigin: session.apiOrigin,
        accessToken: session.accessToken,
        fetch: fetchImpl,
      }).getLedger(childId);
    },
    enabled: selectedChildId !== undefined,
  });

  if (!snapshotQuery.data && snapshotQuery.isPending) {
    return <ScreenState message="Loading rewards…" />;
  }
  if (!snapshotQuery.data) {
    return (
      <ScreenState
        message="Rewards could not be loaded."
        primaryActionLabel="Try again"
        onPrimaryAction={() => void snapshotQuery.refetch()}
        actionLabel={onReportProblem ? 'Report this problem' : undefined}
        onAction={
          onReportProblem
            ? () =>
                onReportProblem({
                  category: 'BROKEN',
                  screen: 'PARENT_REWARDS',
                })
            : undefined
        }
      />
    );
  }

  const snapshot = snapshotQuery.data;
  const selectedChild = snapshot.children.find(
    (child) => child.profile.id === selectedChildId,
  );
  const changeDraft = (change: Partial<LedgerEntryDraft>) => {
    if (draftFrozen) return;
    setDraftState((current) => ({
      ...current,
      draft: { ...current.draft, ...change },
    }));
    setError(undefined);
    setReportableError(false);
    setSuccess(undefined);
  };
  const selectChild = (childId: string) => {
    setSelectedChildId(childId);
    setDraftState(newLedgerDraft(childId));
    setDraftFrozen(false);
    setError(undefined);
    setReportableError(false);
    setSuccess(undefined);
  };

  const saveEntry = async () => {
    if (submitting || !selectedChild) return;
    let input: ReturnType<typeof ManualLedgerEntrySchema.parse>;
    try {
      input = ManualLedgerEntrySchema.parse({
        householdId: snapshot.household.id,
        childId: ChildIdSchema.parse(draftState.draft.childId),
        amountCents: ledgerAmount(draftState.draft),
        type: draftState.draft.kind,
        note: requiredNote(draftState.draft.note),
        idempotencyKey: draftState.idempotencyKey,
      });
    } catch (caught) {
      setError(ledgerValidationMessage(caught));
      setReportableError(false);
      return;
    }
    setSubmitting(true);
    setDraftFrozen(true);
    setError(undefined);
    setReportableError(false);
    setSuccess(undefined);
    const operationGeneration = generation.current;
    let responseStatus: number | undefined;
    const statusTrackingFetch: typeof globalThis.fetch = async (...args) => {
      const response = await fetchImpl(...args);
      responseStatus = response.status;
      return response;
    };
    try {
      await createFamilyApiClient({
        apiOrigin: session.apiOrigin,
        accessToken: session.accessToken,
        fetch: statusTrackingFetch,
      }).recordLedgerEntry(input);
      if (generation.current !== operationGeneration) return;
      if (responseStatus !== 201) throw new UnconfirmedLedgerEntryError();
      setDraftState(newLedgerDraft(selectedChild.profile.id));
      setDraftFrozen(false);
      setSuccess('Ledger entry saved.');
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: familyQueryKeys.parentSnapshot(session),
        }),
        queryClient.invalidateQueries({
          queryKey: familyQueryKeys.ledger(session, selectedChild.profile.id),
        }),
      ]).catch(() => undefined);
    } catch (caught) {
      if (generation.current === operationGeneration) {
        if (isConfirmedValidationError(caught)) setDraftFrozen(false);
        setError(ledgerOperationMessage(caught));
        setReportableError(!isConfirmedValidationError(caught));
      }
    } finally {
      if (generation.current === operationGeneration) setSubmitting(false);
    }
  };

  const transactions = [...(ledgerQuery.data?.transactions ?? [])].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id),
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PARENT TOOLS</Text>
      <Text style={styles.title}>Rewards</Text>
      <Text style={styles.summary}>
        Choose a child to see their full ledger.
      </Text>
      <View style={styles.childRow}>
        {snapshot.children.map((child) => (
          <Pressable
            key={child.profile.id}
            accessibilityLabel={`View ${child.profile.name} rewards`}
            accessibilityRole="button"
            accessibilityState={{
              disabled: submitting || draftFrozen,
              selected: child.profile.id === selectedChildId,
            }}
            disabled={submitting || draftFrozen}
            onPress={() => selectChild(child.profile.id)}
            style={[
              styles.childButton,
              child.profile.id === selectedChildId && styles.selectedChild,
            ]}
          >
            <Text style={styles.childName}>{child.profile.name}</Text>
          </Pressable>
        ))}
      </View>
      {selectedChild ? (
        ledgerQuery.isPending && !ledgerQuery.data ? (
          <ScreenState
            message={`Loading ${selectedChild.profile.name}'s rewards…`}
          />
        ) : !ledgerQuery.data ? (
          <ScreenState
            message="This ledger could not be loaded."
            primaryActionLabel="Try again"
            onPrimaryAction={() => void ledgerQuery.refetch()}
            actionLabel={onReportProblem ? 'Report this problem' : undefined}
            onAction={
              onReportProblem
                ? () =>
                    onReportProblem({
                      category: 'BROKEN',
                      screen: 'PARENT_REWARDS',
                    })
                : undefined
            }
          />
        ) : (
          <View style={styles.ledger}>
            <Text style={styles.balanceLabel}>
              {selectedChild.profile.name}'s balance
            </Text>
            <Text style={styles.balance}>
              {formatCents(ledgerQuery.data.balanceCents, 'en-US')}
            </Text>
            <LedgerEntryForm
              draft={draftState.draft}
              disabled={submitting}
              draftFrozen={draftFrozen}
              error={error}
              success={success}
              onChange={changeDraft}
              onStartNewOperation={() => {
                setDraftState((current) => ({
                  ...current,
                  idempotencyKey: createSecureUuid(),
                }));
                setDraftFrozen(false);
                setError(undefined);
                setReportableError(false);
                setSuccess(undefined);
              }}
              onSubmit={() => void saveEntry()}
            />
            {error && reportableError && onReportProblem ? (
              <ScreenStateAction
                label="Report this problem"
                onPress={() =>
                  onReportProblem({
                    category: 'BROKEN',
                    screen: 'PARENT_REWARDS',
                  })
                }
              />
            ) : null}
            <Text style={styles.historyHeading}>History</Text>
            {transactions.length === 0 ? (
              <Text style={styles.summary}>No ledger entries yet.</Text>
            ) : (
              transactions.map((transaction) => (
                <LedgerRow
                  key={transaction.id}
                  transaction={transaction}
                  timeZone={snapshot.household.timeZone}
                />
              ))
            )}
          </View>
        )
      ) : null}
    </ScrollView>
  );
}

function newLedgerDraft(childId: string): LedgerDraftState {
  return {
    draft: {
      childId,
      kind: 'PURCHASE',
      amountInput: '',
      note: '',
    },
    idempotencyKey: createSecureUuid(),
  };
}

function ledgerAmount(draft: LedgerEntryDraft): number {
  const value = draft.amountInput.trim();
  if (draft.kind === 'CORRECTION') {
    if (!/^[+-]/.test(value)) {
      throw new RangeError('Corrections must start with + or -.');
    }
    return parseSignedDollars(value);
  }
  const magnitude = parseUnsignedDollars(value);
  if (magnitude === 0)
    throw new RangeError('Amount must be greater than zero.');
  return draft.kind === 'PURCHASE' ? -magnitude : magnitude;
}

function requiredNote(value: string): string {
  const note = value.trim();
  if (!note) throw new RangeError('Enter a note.');
  return note;
}

function ledgerValidationMessage(error: unknown): string {
  if (error instanceof RangeError) {
    if (error.message.startsWith('Corrections')) return error.message;
    if (error.message.startsWith('Enter a note')) return error.message;
    if (error.message.startsWith('Amount must')) return error.message;
    return 'Enter dollars with no more than two decimals.';
  }
  if (error instanceof Error) return error.message;
  return 'The ledger entry is invalid.';
}

class UnconfirmedLedgerEntryError extends Error {}

function ledgerOperationMessage(error: unknown): string {
  if (error instanceof UnconfirmedLedgerEntryError) {
    return 'The server did not confirm the ledger entry.';
  }
  if (error instanceof FamilyApiError || error instanceof Error) {
    return error.message;
  }
  return 'The ledger entry could not be saved.';
}

function isConfirmedValidationError(error: unknown): boolean {
  return error instanceof FamilyApiError && error.kind === 'VALIDATION';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: { gap: familyTokens.space.md, padding: familyTokens.space.lg },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 30, fontWeight: '800' },
  summary: { color: familyTokens.color.mutedInk, fontSize: 15 },
  childRow: { flexDirection: 'row', gap: familyTokens.space.sm },
  childButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E3E7E9',
    borderRadius: familyTokens.radius.small,
    backgroundColor: familyTokens.color.surface,
  },
  selectedChild: { borderColor: familyTokens.color.focus },
  childName: { color: familyTokens.color.ink, fontSize: 17, fontWeight: '800' },
  ledger: { gap: familyTokens.space.md },
  balanceLabel: { color: familyTokens.color.mutedInk, fontSize: 15 },
  balance: { color: familyTokens.color.ink, fontSize: 36, fontWeight: '800' },
  historyHeading: {
    color: familyTokens.color.ink,
    fontSize: 22,
    fontWeight: '800',
  },
});
