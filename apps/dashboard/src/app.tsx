import {
  createDiagnosticBuffer,
  createDiagnosticFetch,
  createFamilyApiClient,
  createFeedbackOutbox,
  createFeedbackRetryController,
  createSecureUuid,
  FamilyApiError,
  familyQueryKeys,
  type ClientSession,
  type FamilyApiClient,
  type FeedbackOutbox,
  type FeedbackRetryOutcome,
  type FeedbackRetryScheduler,
} from '@family/api-client';
import {
  CreateFeedbackCommandSchema,
  normalizeLocalDevelopmentOrigin,
  type DashboardChore,
  type DashboardSnapshot,
  type FeedbackScreen as FeedbackScreenName,
} from '@family/contracts';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createDashboardSessionStore,
  type DashboardSessionStore,
} from './auth/dashboard-session';
import { TellUsButton } from './components/tell-us-button';
import { estimateServerOffsetMs } from './features/chores/countdown';
import type {
  OpenFeedbackDraft,
  ReportProblemContext,
} from './features/feedback/contextual-feedback';
import {
  createDashboardDehydrateOptions,
  createDashboardQueryClient,
  createDashboardQueryPersister,
  dashboardQueryCacheBuster,
  dashboardSnapshotQueryOptions,
} from './query/dashboard-query';
import {
  createBrowserStorage,
  createIndexedDbStorage,
  type AsyncKeyValueStore,
} from './query/indexed-db-storage';
import { ActiveChoreScreen } from './screens/active-chore-screen';
import { ChoreBoardScreen } from './screens/chore-board-screen';
import { ChoreDetailScreen } from './screens/chore-detail-screen';
import { FamilyHomeView } from './screens/family-home-screen';
import {
  FeedbackScreen,
  resultMessage,
  type DashboardFeedbackSubmission,
  type DashboardFeedbackSubmissionResult,
} from './screens/feedback-screen';

export const DASHBOARD_FEEDBACK_OUTBOX_KEY =
  'family-dashboard-feedback-outbox:v1';

const DASHBOARD_FEEDBACK_EXPIRES_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;
const DASHBOARD_FEEDBACK_NOTICE_MS = 30_000;

type DashboardFeedbackClient = Pick<FamilyApiClient, 'createFeedback'> &
  Partial<Pick<FamilyApiClient, 'cancelPendingRequests'>>;

type FeedbackRuntimeContext = {
  generation: number;
  scope: string | undefined;
  client: DashboardFeedbackClient | undefined;
  isOnline: boolean;
};

const DevelopmentSetupScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./screens/setup-screen').then(({ SetupScreen }) => ({
        default: SetupScreen,
      })),
    )
  : undefined;

export function App({
  sessionStore: sessionStoreOverride,
  queryStorage: queryStorageOverride,
  fetch: fetchImpl = globalThis.fetch,
  feedbackRetryScheduler,
  randomUUID = createSecureUuid,
}: {
  sessionStore?: DashboardSessionStore;
  queryStorage?: AsyncKeyValueStore;
  fetch?: typeof globalThis.fetch;
  feedbackRetryScheduler?: FeedbackRetryScheduler;
  randomUUID?: () => string;
}) {
  const [defaultQueryStorage] = useState(createIndexedDbStorage);
  const queryStorage = queryStorageOverride ?? defaultQueryStorage;
  const sessionStore = useMemo(
    () =>
      sessionStoreOverride ??
      createDashboardSessionStore({
        sessionStorage: createBrowserStorage(window.localStorage),
        queryStorage,
      }),
    [queryStorage, sessionStoreOverride],
  );
  const [session, setSession] = useState<ClientSession>();
  const [hasLoadedSession, setHasLoadedSession] = useState(false);
  const loadedSessionStoreRef = useRef<DashboardSessionStore | undefined>(
    undefined,
  );
  const activeSession =
    loadedSessionStoreRef.current === sessionStore ? session : undefined;
  const hasLoadedActiveSession =
    loadedSessionStoreRef.current === sessionStore && hasLoadedSession;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] =
    useState<ReportProblemContext>();
  const [feedbackNotice, setFeedbackNotice] = useState<string>();
  const [feedbackSyncMessage, setFeedbackSyncMessage] = useState<string>();
  const [isFeedbackOnline, setIsFeedbackOnline] = useState(() =>
    onlineManager.isOnline(),
  );
  const feedbackButtonRef = useRef<HTMLButtonElement>(null);
  const feedbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const latestContentActivationRef = useRef<HTMLElement | null>(null);
  const feedbackNoticeTimerRef = useRef<number | undefined>(undefined);
  const feedbackFocusTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const currentScreenRef = useRef<FeedbackScreenName>('SETUP');
  const feedbackOpenRef = useRef(false);
  const drainRequestedRef = useRef(false);
  const drainPromiseRef = useRef<Promise<unknown> | undefined>(undefined);
  const deliveryFailuresRef = useRef(new Map<string, unknown>());
  const retryAttemptRef = useRef<() => Promise<FeedbackRetryOutcome>>(
    async () => 'STOP',
  );
  const [feedbackRetryController] = useState(() =>
    createFeedbackRetryController({
      ...(feedbackRetryScheduler ? { scheduler: feedbackRetryScheduler } : {}),
      attempt: () => retryAttemptRef.current(),
    }),
  );
  const runtimeGenerationRef = useRef(0);
  const previousRuntimeIdentityRef = useRef<
    | {
        scope: string | undefined;
        client: DashboardFeedbackClient | undefined;
      }
    | undefined
  >(undefined);
  const [feedbackResources] = useState(() =>
    createFeedbackResources(queryStorage, randomUUID),
  );
  const diagnosticFetch = useMemo(
    () =>
      createDiagnosticFetch(fetchImpl, feedbackResources.diagnostics, () =>
        Date.now(),
      ),
    [feedbackResources, fetchImpl],
  );
  const feedbackScope = useMemo(
    () => validDashboardFeedbackScope(activeSession),
    [activeSession],
  );
  const previousDiagnosticScopeRef = useRef<{
    initialized: boolean;
    scope: string | undefined;
  }>({ initialized: false, scope: undefined });
  if (!previousDiagnosticScopeRef.current.initialized) {
    previousDiagnosticScopeRef.current = {
      initialized: true,
      scope: feedbackScope,
    };
  } else if (previousDiagnosticScopeRef.current.scope !== feedbackScope) {
    const previousScope = previousDiagnosticScopeRef.current.scope;
    previousDiagnosticScopeRef.current = {
      initialized: true,
      scope: feedbackScope,
    };
    if (previousScope !== undefined) {
      feedbackResources.diagnostics.reset('SETUP');
    }
  }
  const feedbackClient = useMemo<DashboardFeedbackClient | undefined>(() => {
    if (!activeSession || !feedbackScope) return undefined;
    const client = createFamilyApiClient({
      apiOrigin: activeSession.apiOrigin,
      accessToken: activeSession.accessToken,
      fetch: diagnosticFetch,
    });
    return {
      createFeedback: client.createFeedback,
      cancelPendingRequests: client.cancelPendingRequests,
    };
  }, [activeSession, diagnosticFetch, feedbackScope]);

  useEffect(
    () => () => feedbackClient?.cancelPendingRequests?.(),
    [feedbackClient],
  );

  if (
    previousRuntimeIdentityRef.current?.scope !== feedbackScope ||
    previousRuntimeIdentityRef.current?.client !== feedbackClient
  ) {
    runtimeGenerationRef.current += 1;
    previousRuntimeIdentityRef.current = {
      scope: feedbackScope,
      client: feedbackClient,
    };
  }
  const runtimeContextRef = useRef<FeedbackRuntimeContext>({
    generation: runtimeGenerationRef.current,
    scope: feedbackScope,
    client: feedbackClient,
    isOnline: isFeedbackOnline,
  });
  runtimeContextRef.current = {
    generation: runtimeGenerationRef.current,
    scope: feedbackScope,
    client: feedbackClient,
    isOnline: isFeedbackOnline,
  };

  const requestFeedbackDrain = useCallback((): Promise<unknown> => {
    drainRequestedRef.current = true;
    if (drainPromiseRef.current) return drainPromiseRef.current;

    const run = async (): Promise<unknown> => {
      let lastFailure: unknown;
      while (drainRequestedRef.current) {
        drainRequestedRef.current = false;
        const attemptGeneration = runtimeContextRef.current.generation;
        try {
          await feedbackResources.outbox.list();
        } catch (error) {
          lastFailure = new NonRetryableFeedbackFailure(error);
          if (runtimeContextRef.current.generation === attemptGeneration) {
            drainRequestedRef.current = false;
          }
          if (mountedRef.current) {
            setFeedbackSyncMessage(
              'Saved feedback could not be checked. Try again later.',
            );
          }
          return lastFailure;
        }

        const context = runtimeContextRef.current;
        if (!context.scope) continue;
        try {
          await feedbackResources.outbox.bindUnscoped(context.scope);
        } catch (error) {
          lastFailure = new NonRetryableFeedbackFailure(error);
          if (runtimeContextRef.current.generation === context.generation) {
            drainRequestedRef.current = false;
          }
          if (mountedRef.current) {
            setFeedbackSyncMessage(
              'Saved feedback could not be checked. Try again later.',
            );
          }
          return lastFailure;
        }
        if (
          runtimeContextRef.current.generation !== context.generation ||
          !context.isOnline ||
          !context.client
        ) {
          continue;
        }

        let deliveryFailure: unknown;
        try {
          const delivery = await feedbackResources.outbox.flush({
            scope: context.scope,
            bindUnscoped: false,
            deliver: async (command) => {
              if (runtimeContextRef.current.generation !== context.generation) {
                throw new StaleDashboardFeedbackScopeError();
              }
              deliveryFailuresRef.current.delete(command.idempotencyKey);
              try {
                return await context.client!.createFeedback(command);
              } catch (error) {
                deliveryFailure = error;
                deliveryFailuresRef.current.set(command.idempotencyKey, error);
                throw error;
              }
            },
          });
          if (delivery.stoppedOnError) {
            lastFailure = deliveryFailure;
            if (runtimeContextRef.current.generation === context.generation) {
              drainRequestedRef.current = false;
            }
          }
          if (
            mountedRef.current &&
            runtimeContextRef.current.generation === context.generation
          ) {
            setFeedbackSyncMessage(
              delivery.stoppedOnError
                ? messageForDeliveryFailure(deliveryFailure)
                : undefined,
            );
          }
          if (delivery.stoppedOnError) return lastFailure;
        } catch (error) {
          lastFailure = new NonRetryableFeedbackFailure(error);
          if (runtimeContextRef.current.generation === context.generation) {
            drainRequestedRef.current = false;
          }
          if (mountedRef.current) {
            setFeedbackSyncMessage(
              'Saved feedback could not be checked. Try again later.',
            );
          }
          return lastFailure;
        }
      }
      return lastFailure;
    };

    const promise = run().finally(() => {
      if (drainPromiseRef.current === promise) {
        drainPromiseRef.current = undefined;
      }
      if (drainRequestedRef.current && mountedRef.current) {
        void requestFeedbackDrain();
      }
    });
    drainPromiseRef.current = promise;
    return promise;
  }, [feedbackResources]);
  retryAttemptRef.current = async () => {
    const failure = await requestFeedbackDrain();
    if (failure === undefined) return 'SUCCESS';
    if (
      failure instanceof NonRetryableFeedbackFailure ||
      failure instanceof StaleDashboardFeedbackScopeError
    ) {
      return 'STOP';
    }
    return isRetryableFeedbackFailure(failure) ? 'RETRY' : 'STOP';
  };

  useEffect(() => {
    let active = true;
    void sessionStore.load().then((loaded) => {
      if (active) {
        loadedSessionStoreRef.current = sessionStore;
        setSession(loaded);
        setHasLoadedSession(true);
      }
    });
    return () => {
      active = false;
    };
  }, [sessionStore]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (feedbackNoticeTimerRef.current !== undefined) {
        window.clearTimeout(feedbackNoticeTimerRef.current);
      }
      if (feedbackFocusTimerRef.current !== undefined) {
        window.clearTimeout(feedbackFocusTimerRef.current);
      }
      feedbackRetryController.cancel();
      queueMicrotask(() => {
        if (!mountedRef.current) feedbackResources.outbox.dispose();
      });
    };
  }, [feedbackResources, feedbackRetryController]);

  useEffect(
    () => onlineManager.subscribe((online) => setIsFeedbackOnline(online)),
    [],
  );

  const lastNetworkStateRef = useRef<'ONLINE' | 'OFFLINE' | undefined>(
    undefined,
  );
  useEffect(() => {
    const state = isFeedbackOnline ? 'ONLINE' : 'OFFLINE';
    if (lastNetworkStateRef.current !== state) {
      if (lastNetworkStateRef.current !== undefined) {
        feedbackRetryController.reset();
      }
      lastNetworkStateRef.current = state;
      feedbackResources.diagnostics.recordNetwork(state);
    }
    void feedbackRetryController.trigger();
  }, [feedbackResources, feedbackRetryController, isFeedbackOnline]);

  const previousRetryScopeRef = useRef(feedbackScope);
  useEffect(() => {
    if (previousRetryScopeRef.current !== feedbackScope) {
      previousRetryScopeRef.current = feedbackScope;
      feedbackRetryController.reset();
    }
    void feedbackRetryController.trigger();
  }, [feedbackClient, feedbackRetryController, feedbackScope]);

  useEffect(() => {
    function retryWhenVisible() {
      if (document.visibilityState === 'visible') {
        void feedbackRetryController.trigger();
      }
    }
    document.addEventListener('visibilitychange', retryWhenVisible);
    return () =>
      document.removeEventListener('visibilitychange', retryWhenVisible);
  }, [feedbackRetryController]);

  const recordScreen = useCallback(
    (screen: FeedbackScreenName) => {
      currentScreenRef.current = screen;
      if (!feedbackOpenRef.current) {
        feedbackResources.diagnostics.recordScreen(screen);
      }
    },
    [feedbackResources],
  );

  function openFeedback(
    context?: ReportProblemContext,
    returnFocusTarget: HTMLElement | null = feedbackButtonRef.current,
  ) {
    if (!mountedRef.current) return;
    feedbackReturnFocusRef.current = returnFocusTarget;
    setFeedbackContext(context);
    feedbackOpenRef.current = true;
    setFeedbackOpen(true);
    feedbackResources.diagnostics.recordScreen(
      feedbackScreenForContext(context),
    );
  }

  function closeFeedback() {
    if (!mountedRef.current) return;
    feedbackOpenRef.current = false;
    setFeedbackOpen(false);
    setFeedbackContext(undefined);
    feedbackResources.diagnostics.recordScreen(currentScreenRef.current);
    if (feedbackFocusTimerRef.current !== undefined) {
      window.clearTimeout(feedbackFocusTimerRef.current);
    }
    feedbackFocusTimerRef.current = window.setTimeout(() => {
      feedbackFocusTimerRef.current = undefined;
      if (!mountedRef.current) return;
      const returnTarget = feedbackReturnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      } else {
        feedbackButtonRef.current?.focus();
      }
      feedbackReturnFocusRef.current = null;
    }, 0);
  }

  const reportProblem: OpenFeedbackDraft = (context) => {
    openFeedback(context, latestContentActivationRef.current);
  };

  function acknowledgeFeedback(result: DashboardFeedbackSubmissionResult) {
    if (!mountedRef.current) return;
    setFeedbackNotice(resultMessage(result.status));
    if (feedbackNoticeTimerRef.current !== undefined) {
      window.clearTimeout(feedbackNoticeTimerRef.current);
    }
    feedbackNoticeTimerRef.current = window.setTimeout(() => {
      feedbackNoticeTimerRef.current = undefined;
      if (mountedRef.current) setFeedbackNotice(undefined);
    }, DASHBOARD_FEEDBACK_NOTICE_MS);
    closeFeedback();
  }

  async function submitFeedback({
    category,
    description,
  }: DashboardFeedbackSubmission): Promise<DashboardFeedbackSubmissionResult> {
    const context = runtimeContextRef.current;
    const command = CreateFeedbackCommandSchema.parse({
      idempotencyKey: randomUUID(),
      category,
      description,
      diagnosticSnapshot: feedbackResources.diagnostics.snapshot(),
    });
    const entryId = await feedbackResources.outbox.enqueue(
      command,
      context.scope,
    );

    let result: DashboardFeedbackSubmissionResult;
    try {
      await feedbackRetryController.trigger({ followUp: true });
      const remainsQueued = (await feedbackResources.outbox.list()).some(
        (entry) => entry.id === entryId,
      );
      result = {
        status: remainsQueued
          ? feedbackSubmissionFailureStatus(
              deliveryFailuresRef.current.get(command.idempotencyKey) ??
                undefined,
            )
          : 'delivered',
      };
    } catch {
      result = { status: 'saved' };
    }

    return result;
  }

  let applicationContent;

  if (!hasLoadedActiveSession) {
    applicationContent = (
      <main className="screen-state">Opening Family Kitchen…</main>
    );
  } else if (!activeSession) {
    if (!DevelopmentSetupScreen) {
      applicationContent = (
        <main className="screen-state">
          Local dashboard deployment is not configured.
        </main>
      );
    } else {
      applicationContent = (
        <Suspense
          fallback={<main className="screen-state">Opening setup…</main>}
        >
          <DevelopmentSetupScreen
            sessionStore={sessionStore}
            browserOrigin={window.location.origin}
            onReportProblem={reportProblem}
            onComplete={() => {
              void sessionStore.load().then((loaded) => {
                loadedSessionStoreRef.current = sessionStore;
                setSession(loaded);
              });
            }}
          />
        </Suspense>
      );
    }
  } else {
    applicationContent = (
      <DashboardData
        session={activeSession}
        queryStorage={queryStorage}
        fetch={diagnosticFetch}
        onScreenChange={recordScreen}
        onReportProblem={reportProblem}
      />
    );
  }

  return (
    <>
      <div
        data-testid="dashboard-content"
        aria-hidden={feedbackOpen || undefined}
        inert={feedbackOpen || undefined}
        onClickCapture={(event) => {
          latestContentActivationRef.current =
            event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>('button')
              : null;
        }}
      >
        {applicationContent}
      </div>
      {feedbackOpen ? (
        <FeedbackScreen
          context={feedbackContext}
          onClose={closeFeedback}
          onSubmit={submitFeedback}
          onAcknowledged={acknowledgeFeedback}
        />
      ) : (
        <TellUsButton ref={feedbackButtonRef} onPress={() => openFeedback()} />
      )}
      {!feedbackOpen && (feedbackNotice ?? feedbackSyncMessage) ? (
        <p className="feedback-notice" role="status" aria-live="polite">
          {feedbackNotice ?? feedbackSyncMessage}
        </p>
      ) : null}
    </>
  );
}

function DashboardData({
  session,
  queryStorage,
  fetch: fetchImpl,
  onScreenChange,
  onReportProblem,
}: {
  session: ClientSession;
  queryStorage: AsyncKeyValueStore;
  fetch: typeof globalThis.fetch;
  onScreenChange(screen: FeedbackScreenName): void;
  onReportProblem: OpenFeedbackDraft;
}) {
  const queryClient = useMemo(
    () => createDashboardQueryClient(session),
    [session],
  );
  const persister = useMemo(
    () => createDashboardQueryPersister(queryStorage, session),
    [queryStorage, session],
  );

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: dashboardQueryCacheBuster(session),
        dehydrateOptions: createDashboardDehydrateOptions(session),
      }}
    >
      <DashboardFlow
        session={session}
        fetch={fetchImpl}
        onScreenChange={onScreenChange}
        onReportProblem={onReportProblem}
      />
    </PersistQueryClientProvider>
  );
}

type DashboardRoute =
  | { name: 'home' }
  | { name: 'board' }
  | { name: 'detail'; choreId: DashboardChore['id'] }
  | {
      name: 'active';
      choreId: DashboardChore['id'];
      childId: DashboardSnapshot['children'][number]['profile']['id'];
    };

type ClaimTombstones = ReadonlyMap<DashboardChore['id'], number>;

function DashboardFlow({
  session,
  fetch: fetchImpl,
  onScreenChange,
  onReportProblem,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  onScreenChange(screen: FeedbackScreenName): void;
  onReportProblem: OpenFeedbackDraft;
}) {
  const [route, setRoute] = useState<DashboardRoute>({ name: 'home' });
  const routeGenerationRef = useRef(0);
  const snapshotReceiptGenerationRef = useRef(0);
  const [claimTombstones, setClaimTombstones] = useState<ClaimTombstones>(
    () => new Map(),
  );
  const [isQueryOnline, setIsQueryOnline] = useState(() =>
    onlineManager.isOnline(),
  );
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(
    dashboardSnapshotQueryOptions(session, fetchImpl),
  );
  const client = useMemo(
    () =>
      createFamilyApiClient({
        apiOrigin: session.apiOrigin,
        accessToken: session.accessToken,
        fetch: fetchImpl,
      }),
    [fetchImpl, session.accessToken, session.apiOrigin],
  );
  const snapshotKey = useMemo(
    () => familyQueryKeys.dashboardSnapshot(session),
    [session],
  );

  useEffect(() => {
    onScreenChange(feedbackScreenForRoute(route));
  }, [onScreenChange, route]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type !== 'updated' ||
          event.action.type !== 'success' ||
          event.action.manual === true ||
          !queryKeysEqual(event.query.queryKey, snapshotKey)
        ) {
          return;
        }
        snapshotReceiptGenerationRef.current += 1;
        const receiptGeneration = snapshotReceiptGenerationRef.current;
        setClaimTombstones((current) =>
          reconcileClaimTombstones(current, receiptGeneration),
        );
      }),
    [queryClient, snapshotKey],
  );

  useEffect(
    () => onlineManager.subscribe((online) => setIsQueryOnline(online)),
    [],
  );
  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: snapshotKey });
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () =>
      document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [queryClient, snapshotKey]);

  async function refreshSnapshot({
    throwOnError = false,
  }: { throwOnError?: boolean } = {}) {
    await queryClient.invalidateQueries(
      { queryKey: snapshotKey },
      { throwOnError },
    );
  }

  function navigate(nextRoute: DashboardRoute) {
    routeGenerationRef.current += 1;
    setRoute(nextRoute);
  }

  if (!snapshotQuery.data) {
    return (
      <FamilyHomeView
        snapshot={undefined}
        isPending={snapshotQuery.isPending}
        isFetching={snapshotQuery.isFetching}
        dataUpdatedAt={snapshotQuery.dataUpdatedAt}
        isOnline={navigator.onLine}
        onRetry={() => void snapshotQuery.refetch()}
        failure={snapshotQuery.error}
        onReportProblem={onReportProblem}
      />
    );
  }
  const snapshot = snapshotQuery.data;

  if (route.name === 'board') {
    return (
      <ChoreBoardScreen
        chores={snapshot.chores}
        pendingClaimChoreIds={new Set(claimTombstones.keys())}
        onOpenChore={(chore) => navigate({ name: 'detail', choreId: chore.id })}
        onBack={() => navigate({ name: 'home' })}
      />
    );
  }

  if (route.name === 'detail') {
    const chore = snapshot.chores.find(({ id }) => id === route.choreId);
    if (!chore) {
      return (
        <main className="screen-state">
          <p>That chore is no longer on the board.</p>
          <button
            type="button"
            className="primary-action"
            onClick={() => navigate({ name: 'board' })}
          >
            Back to Chore Board
          </button>
        </main>
      );
    }
    return (
      <ChoreDetailScreen
        chore={chore}
        children={snapshot.children}
        claim={(input) => client.claimChore(input)}
        isOnline={navigator.onLine}
        isConnectivityPaused={!isQueryOnline}
        isClaimTransitionPending={claimTombstones.has(chore.id)}
        onClaimed={async (childId) => {
          const originGeneration = routeGenerationRef.current;
          const receiptGeneration = snapshotReceiptGenerationRef.current;
          setClaimTombstones((current) =>
            recordClaimTombstone(current, chore.id, receiptGeneration),
          );
          await refreshSnapshot({ throwOnError: true });
          if (routeGenerationRef.current === originGeneration) {
            navigate({ name: 'active', choreId: chore.id, childId });
          }
        }}
        onCancelClaimTransition={() => {
          routeGenerationRef.current += 1;
        }}
        onBack={() => navigate({ name: 'board' })}
        onRefresh={refreshSnapshot}
        onReportProblem={onReportProblem}
      />
    );
  }

  if (route.name === 'active') {
    const chore = snapshot.chores.find(({ id }) => id === route.choreId);
    const child = snapshot.children.find(
      ({ profile }) => profile.id === route.childId,
    );
    if (!chore || !child) {
      return (
        <main className="screen-state">
          <p>This chore has been updated by the family server.</p>
          <button
            type="button"
            className="primary-action"
            onClick={() => navigate({ name: 'home' })}
          >
            Back home
          </button>
        </main>
      );
    }
    return (
      <ActiveChoreScreen
        chore={chore}
        child={child}
        serverOffsetMs={estimateServerOffsetMs(
          snapshot.serverTime,
          snapshotQuery.dataUpdatedAt,
        )}
        isOnline={navigator.onLine}
        isConnectivityPaused={!isQueryOnline}
        submit={(input) => client.submitChore(input)}
        onSubmitted={() => undefined}
        onBack={() => navigate({ name: 'home' })}
        onRefresh={() => void refreshSnapshot()}
        onReportProblem={onReportProblem}
      />
    );
  }

  return (
    <FamilyHomeView
      snapshot={snapshot}
      isPending={snapshotQuery.isPending}
      isFetching={snapshotQuery.isFetching}
      dataUpdatedAt={snapshotQuery.dataUpdatedAt}
      isOnline={navigator.onLine}
      onOpenChoreBoard={() => navigate({ name: 'board' })}
      onOpenActiveChore={(chore, child) =>
        navigate({
          name: 'active',
          choreId: chore.id,
          childId: child.profile.id,
        })
      }
      onReportProblem={onReportProblem}
    />
  );
}

function recordClaimTombstone(
  current: ClaimTombstones,
  choreId: DashboardChore['id'],
  receiptGeneration: number,
): ClaimTombstones {
  const next = new Map(current);
  next.set(choreId, receiptGeneration);
  return next;
}

function reconcileClaimTombstones(
  current: ClaimTombstones,
  receiptGeneration: number,
): ClaimTombstones {
  const reconciled = new Map(current);
  for (const [choreId, createdAfterReceipt] of current) {
    if (createdAfterReceipt < receiptGeneration) reconciled.delete(choreId);
  }
  return reconciled.size === current.size ? current : reconciled;
}

function createFeedbackResources(
  storage: AsyncKeyValueStore,
  randomUUID: () => string,
): {
  diagnostics: ReturnType<typeof createDiagnosticBuffer>;
  outbox: FeedbackOutbox;
} {
  const now = () => Date.now();
  return {
    diagnostics: createDiagnosticBuffer({
      source: 'DASHBOARD',
      appVersion:
        typeof __FAMILY_APP_VERSION__ === 'string'
          ? __FAMILY_APP_VERSION__
          : 'development',
      now,
    }),
    outbox: createFeedbackOutbox({
      storage,
      key: DASHBOARD_FEEDBACK_OUTBOX_KEY,
      coordinationIdentity: storage.coordinationIdentity ?? storage,
      expiresAfterMs: DASHBOARD_FEEDBACK_EXPIRES_AFTER_MS,
      now,
      randomUUID,
    }),
  };
}

export function dashboardFeedbackScope(session: ClientSession): string {
  if (session.role !== 'DASHBOARD') {
    throw new Error('Dashboard feedback requires a dashboard session.');
  }
  const apiOrigin = normalizeLocalDevelopmentOrigin(session.apiOrigin);
  if (!apiOrigin) {
    throw new Error('Dashboard feedback requires a local API origin.');
  }
  return JSON.stringify([
    apiOrigin,
    session.householdId,
    session.actorId,
    session.role,
  ]);
}

function validDashboardFeedbackScope(
  session: ClientSession | undefined,
): string | undefined {
  if (!session) return undefined;
  try {
    return dashboardFeedbackScope(session);
  } catch {
    return undefined;
  }
}

function feedbackSubmissionFailureStatus(
  failure: unknown,
): DashboardFeedbackSubmissionResult['status'] {
  if (isRateLimitFailure(failure)) {
    return 'rate-limited';
  }
  return 'queued';
}

function messageForDeliveryFailure(failure: unknown): string {
  return isRateLimitFailure(failure)
    ? "Your feedback was saved. We'll try again later."
    : 'Your feedback was saved. We will send it when the family server reconnects.';
}

function isRateLimitFailure(failure: unknown): boolean {
  return (
    (failure instanceof FamilyApiError && failure.kind === 'RATE_LIMITED') ||
    (typeof failure === 'object' &&
      failure !== null &&
      'kind' in failure &&
      failure.kind === 'RATE_LIMITED')
  );
}

function isRetryableFeedbackFailure(failure: unknown): boolean {
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

class NonRetryableFeedbackFailure extends Error {
  constructor(readonly cause: unknown) {
    super('Feedback storage could not be synchronized.');
  }
}

class StaleDashboardFeedbackScopeError extends Error {}

function feedbackScreenForRoute(route: DashboardRoute): FeedbackScreenName {
  if (route.name === 'board') return 'DASHBOARD_CHORE_BOARD';
  if (route.name === 'detail') return 'DASHBOARD_CHORE_DETAIL';
  if (route.name === 'active') return 'DASHBOARD_ACTIVE_CHORE';
  return 'DASHBOARD_HOME';
}

function feedbackScreenForContext(
  context: ReportProblemContext | undefined,
): FeedbackScreenName {
  if (!context) return 'DASHBOARD_FEEDBACK';
  switch (context.screen) {
    case 'SETUP':
    case 'DASHBOARD_HOME':
    case 'DASHBOARD_CHORE_DETAIL':
    case 'DASHBOARD_ACTIVE_CHORE':
      return context.screen;
    default:
      return 'DASHBOARD_FEEDBACK';
  }
}

function queryKeysEqual(
  candidate: readonly unknown[],
  expected: readonly unknown[],
): boolean {
  return (
    candidate.length === expected.length &&
    candidate.every((segment, index) => segment === expected[index])
  );
}
