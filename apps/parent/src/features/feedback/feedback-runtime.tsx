import {
  createDiagnosticBuffer,
  createDiagnosticFetch,
  createFeedbackOutbox,
  createFeedbackRetryController,
  FamilyApiError,
  type ClientSession,
  type DiagnosticBuffer,
  type FeedbackOutbox,
  type FeedbackOutboxEntry,
  type FeedbackRetryOutcome,
  type FeedbackRetryScheduler,
  type StringStorage,
} from '@family/api-client';
import {
  CreateFeedbackCommandSchema,
  type ClientDiagnosticSnapshot,
  type FeedbackCategory,
  type FeedbackScreen,
  type FeedbackSource,
} from '@family/contracts';
import { onlineManager } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  createParentFeedbackClient,
  type FeedbackSubmissionClient,
  parentFeedbackScope,
} from './feedback-queries';

export const PARENT_FEEDBACK_OUTBOX_KEY = 'family-parent-feedback-outbox:v1';

export type ParentFeedbackDependencies = {
  now(): Date;
  randomUUID(): string;
  source: Extract<FeedbackSource, 'PARENT_IOS' | 'PARENT_ANDROID'>;
  storage: StringStorage;
  appVersion?: string;
  retryScheduler?: FeedbackRetryScheduler;
};

export type ParentFeedbackSubmission = {
  category: FeedbackCategory;
  description: string;
  includeDiagnostics?: boolean;
  screen?: FeedbackScreen;
};

export type ParentFeedbackSubmissionResult = {
  status: 'delivered' | 'queued' | 'saved';
  diagnosticSnapshot: ClientDiagnosticSnapshot;
};

export type ParentFeedbackRuntime = {
  diagnostics: DiagnosticBuffer;
  fetch: typeof globalThis.fetch;
  isOnline: boolean;
  queuedCount: number;
  queuedEntries: readonly FeedbackOutboxEntry[];
  syncMessage: string | undefined;
  preview(includeDiagnostics?: boolean): ClientDiagnosticSnapshot;
  submit(
    input: ParentFeedbackSubmission,
  ): Promise<ParentFeedbackSubmissionResult>;
  retry(): Promise<void>;
  removeQueued(
    entryId: string,
  ): Promise<'deleted' | 'already-delivered' | 'delivery-unknown' | 'failed'>;
};

type ParentFeedbackProviderProps = PropsWithChildren<{
  session: ClientSession | undefined;
  fetch: typeof globalThis.fetch;
  dependencies: ParentFeedbackDependencies;
  client?: FeedbackSubmissionClient;
  isOnline?: boolean;
}>;

const ParentFeedbackContext = createContext<ParentFeedbackRuntime | null>(null);

export function ParentFeedbackProvider({
  session,
  fetch,
  dependencies,
  client,
  isOnline: isOnlineOverride,
  children,
}: ParentFeedbackProviderProps) {
  const observedOnline = useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  );
  const isOnline = isOnlineOverride ?? observedOnline;
  const [resources] = useState(() => createResources(dependencies));
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const diagnosticFetch = useMemo(
    () =>
      createDiagnosticFetch(fetch, resources.diagnostics, () =>
        resources.now().getTime(),
      ),
    [fetch, resources],
  );
  const submissionClient = useMemo<FeedbackSubmissionClient | undefined>(
    () =>
      session
        ? (client ?? createParentFeedbackClient(session, diagnosticFetch))
        : undefined,
    [client, diagnosticFetch, session],
  );
  const scope = useMemo(
    () => (session ? parentFeedbackScope(session) : undefined),
    [session],
  );
  const previousScopeRef = useRef<{
    initialized: boolean;
    scope: string | undefined;
  }>({ initialized: false, scope: undefined });
  if (!previousScopeRef.current.initialized) {
    previousScopeRef.current = { initialized: true, scope };
  } else if (previousScopeRef.current.scope !== scope) {
    const previousScope = previousScopeRef.current.scope;
    previousScopeRef.current = { initialized: true, scope };
    generationRef.current += 1;
    if (previousScope !== undefined) {
      resources.diagnostics.reset('SETUP');
    }
  }
  const [queuedState, setQueuedState] = useState<{
    scope: string | undefined;
    entries: readonly FeedbackOutboxEntry[];
  }>({ scope, entries: [] });
  const queuedEntries =
    queuedState.scope === scope ? queuedState.entries : ([] as const);
  const queuedCount = queuedEntries.length;
  const [syncMessage, setSyncMessage] = useState<string>();
  const syncMessageRef = useRef(syncMessage);
  syncMessageRef.current = syncMessage;
  const updateSyncMessage = useCallback((next: string | undefined) => {
    if (syncMessageRef.current === next) return;
    syncMessageRef.current = next;
    setSyncMessage(next);
  }, []);
  const lastNetworkState = useRef<'ONLINE' | 'OFFLINE' | undefined>(undefined);
  const retryAttemptRef = useRef<() => Promise<FeedbackRetryOutcome>>(
    async () => 'STOP',
  );
  const [retryController] = useState(() =>
    createFeedbackRetryController({
      ...(dependencies.retryScheduler
        ? { scheduler: dependencies.retryScheduler }
        : {}),
      attempt: () => retryAttemptRef.current(),
    }),
  );

  const refreshQueuedEntries = useCallback(async () => {
    const attemptGeneration = generationRef.current;
    const entries = await resources.outbox.list();
    const visible = entries.filter((entry) =>
      scope
        ? entry.scope === null || entry.scope === scope
        : entry.scope === null,
    );
    if (mountedRef.current && generationRef.current === attemptGeneration) {
      setQueuedState((current) =>
        (current.scope === scope && sameEntryIds(current.entries, visible)) ||
        (current.scope !== scope && visible.length === 0)
          ? current
          : { scope, entries: visible },
      );
    }
  }, [resources, scope]);

  const synchronizeQueued = useCallback(
    async (attemptGeneration: number) => {
      if (!scope) return;
      if (!isOnline || !submissionClient) return;
      let failure: unknown;
      const delivery = await resources.outbox.flush({
        scope,
        bindUnscoped: false,
        deliver: async (command) => {
          if (generationRef.current !== attemptGeneration) {
            throw new StaleFeedbackScopeError();
          }
          try {
            return await submissionClient.createFeedback(command);
          } catch (error) {
            failure = error;
            throw error;
          }
        },
      });
      return { ...delivery, failure };
    },
    [isOnline, resources, scope, submissionClient],
  );

  const attemptDelivery =
    useCallback(async (): Promise<FeedbackRetryOutcome> => {
      const attemptGeneration = generationRef.current;
      try {
        const delivery = await synchronizeQueued(attemptGeneration);
        await refreshQueuedEntries();
        if (
          !mountedRef.current ||
          generationRef.current !== attemptGeneration
        ) {
          return 'STOP';
        }
        if (delivery?.stoppedOnError) {
          updateSyncMessage(messageForParentDeliveryFailure(delivery.failure));
          return isRetryableFeedbackFailure(delivery.failure)
            ? 'RETRY'
            : 'STOP';
        }
        updateSyncMessage(undefined);
        return 'SUCCESS';
      } catch {
        if (mountedRef.current && generationRef.current === attemptGeneration) {
          updateSyncMessage('Saved feedback could not be checked. Try again.');
        }
        return 'STOP';
      }
    }, [refreshQueuedEntries, synchronizeQueued, updateSyncMessage]);
  retryAttemptRef.current = attemptDelivery;

  const flush = useCallback(async () => {
    await retryController.trigger();
  }, [retryController]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      retryController.cancel();
      resources.outbox.dispose();
    };
  }, [resources, retryController]);

  useEffect(
    () => () => submissionClient?.cancelPendingRequests?.(),
    [submissionClient],
  );

  useEffect(() => {
    const attemptGeneration = generationRef.current;
    retryController.reset();
    const prepare = async () => {
      try {
        if (scope) await resources.outbox.bindUnscoped(scope);
        if (mountedRef.current && generationRef.current === attemptGeneration) {
          await retryController.trigger();
        }
      } catch {
        if (mountedRef.current && generationRef.current === attemptGeneration) {
          updateSyncMessage('Saved feedback could not be checked. Try again.');
        }
      }
    };
    void prepare();
  }, [resources, retryController, scope, updateSyncMessage]);

  useEffect(() => {
    const state = isOnline ? 'ONLINE' : 'OFFLINE';
    if (lastNetworkState.current !== state) {
      if (lastNetworkState.current !== undefined) retryController.reset();
      lastNetworkState.current = state;
      resources.diagnostics.recordNetwork(state);
    }
    void retryController.trigger();
  }, [isOnline, resources, retryController]);

  useEffect(() => {
    void retryController.trigger();
  }, [retryController, submissionClient]);

  const preview = useCallback(
    (includeDiagnostics = true) => {
      const snapshot = resources.diagnostics.snapshot();
      return includeDiagnostics ? snapshot : { ...snapshot, events: [] };
    },
    [resources],
  );

  const submit = useCallback(
    async ({
      category,
      description,
      includeDiagnostics = true,
      screen,
    }: ParentFeedbackSubmission): Promise<ParentFeedbackSubmissionResult> => {
      if (screen) resources.diagnostics.recordScreen(screen);
      const command = CreateFeedbackCommandSchema.parse({
        idempotencyKey: resources.randomUUID(),
        category,
        description,
        diagnosticSnapshot: preview(includeDiagnostics),
      });
      const diagnosticSnapshot = command.diagnosticSnapshot;
      const entryId = await resources.outbox.enqueue(command, scope);
      const attemptGeneration = generationRef.current;
      try {
        const deliveryOutcome = await retryController.trigger({
          followUp: true,
        });
        const remainsQueued = (await resources.outbox.list()).some(
          (entry) => entry.id === entryId,
        );
        await refreshQueuedEntries();
        return {
          status:
            remainsQueued && deliveryOutcome === 'STOP'
              ? 'saved'
              : remainsQueued
                ? 'queued'
                : 'delivered',
          diagnosticSnapshot,
        };
      } catch {
        if (mountedRef.current && generationRef.current === attemptGeneration) {
          updateSyncMessage('Saved feedback could not be checked. Try again.');
        }
        return { status: 'saved', diagnosticSnapshot };
      }
    },
    [
      preview,
      refreshQueuedEntries,
      resources,
      retryController,
      scope,
      updateSyncMessage,
    ],
  );

  const removeQueued = useCallback(
    async (
      entryId: string,
    ): Promise<
      'deleted' | 'already-delivered' | 'delivery-unknown' | 'failed'
    > => {
      const attemptGeneration = generationRef.current;
      try {
        const removal = await resources.outbox.remove(entryId, scope);
        await refreshQueuedEntries();
        if (mountedRef.current && generationRef.current === attemptGeneration) {
          updateSyncMessage(
            removal === 'removedUnsent'
              ? 'Saved feedback deleted.'
              : removal === 'deliveryUnknown'
                ? 'Local copy removed. It may already have been delivered.'
                : 'That feedback was already sent or removed.',
          );
        }
        if (removal === 'removedUnsent') return 'deleted';
        if (removal === 'deliveryUnknown') return 'delivery-unknown';
        return 'already-delivered';
      } catch {
        return 'failed';
      }
    },
    [refreshQueuedEntries, resources, scope, updateSyncMessage],
  );

  const value = useMemo<ParentFeedbackRuntime>(
    () => ({
      diagnostics: resources.diagnostics,
      fetch: diagnosticFetch,
      isOnline,
      queuedCount,
      queuedEntries,
      syncMessage,
      preview,
      submit,
      retry: flush,
      removeQueued,
    }),
    [
      diagnosticFetch,
      flush,
      isOnline,
      preview,
      queuedCount,
      queuedEntries,
      removeQueued,
      resources,
      submit,
      syncMessage,
    ],
  );

  return (
    <ParentFeedbackContext.Provider value={value}>
      {children}
    </ParentFeedbackContext.Provider>
  );
}

function sameEntryIds(
  left: readonly FeedbackOutboxEntry[],
  right: readonly FeedbackOutboxEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.id === right[index]?.id &&
        entry.deliveryState === right[index]?.deliveryState,
    )
  );
}

class StaleFeedbackScopeError extends Error {}

function isRetryableFeedbackFailure(failure: unknown): boolean {
  if (failure instanceof StaleFeedbackScopeError) return false;
  if (failure instanceof FamilyApiError) {
    return (
      failure.kind === 'OFFLINE' ||
      failure.kind === 'UNAVAILABLE' ||
      failure.kind === 'RATE_LIMITED' ||
      (failure.status !== undefined && failure.status >= 500)
    );
  }
  return failure instanceof Error;
}

function messageForParentDeliveryFailure(failure: unknown): string {
  return failure instanceof FamilyApiError && failure.kind === 'RATE_LIMITED'
    ? "Your feedback was saved. We'll try again later."
    : 'Feedback is saved on this phone. Your family server did not respond. Try sending again.';
}

export function useFeedbackRuntime(): ParentFeedbackRuntime {
  const value = useContext(ParentFeedbackContext);
  if (!value) {
    throw new Error(
      'useFeedbackRuntime must be used inside ParentFeedbackProvider',
    );
  }
  return value;
}

export function useRecordFeedbackScreen(screen: FeedbackScreen): void {
  const { diagnostics } = useFeedbackRuntime();
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused) diagnostics.recordScreen(screen);
  }, [diagnostics, isFocused, screen]);
}

export function useRecordMountedFeedbackScreen(screen: FeedbackScreen): void {
  const { diagnostics } = useFeedbackRuntime();
  useEffect(() => {
    diagnostics.recordScreen(screen);
  }, [diagnostics, screen]);
}

function createResources(dependencies: ParentFeedbackDependencies): {
  diagnostics: DiagnosticBuffer;
  outbox: FeedbackOutbox;
  now: () => Date;
  randomUUID: () => string;
} {
  const now = dependencies.now;
  return {
    diagnostics: createDiagnosticBuffer({
      source: dependencies.source,
      appVersion: dependencies.appVersion ?? 'development',
      now: () => now().getTime(),
    }),
    outbox: createFeedbackOutbox({
      storage: dependencies.storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
      coordinationIdentity: dependencies.storage,
      now: () => now().getTime(),
    }),
    now,
    randomUUID: dependencies.randomUUID,
  };
}
