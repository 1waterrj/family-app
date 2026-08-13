import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSecureUuid, type ClientSession } from '@family/api-client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  createParentSessionStore,
  type ParentSessionStore,
} from '../auth/session-store';
import { ParentSessionContext } from '../auth/use-session';
import {
  ParentFeedbackProvider,
  type ParentFeedbackDependencies,
  useFeedbackRuntime,
} from '../features/feedback/feedback-runtime';
import {
  createParentQueryClient,
  createParentQueryPersister,
  createParentDehydrateOptions,
  parentQueryCacheBuster,
} from '../query/create-query-client';
import { connectReactNativeQueryManagers } from '../query/react-native-managers';
import { ScreenState } from '../components/screen-state';

export type ParentAppDependencies = {
  sessionStore: ParentSessionStore;
  secureStore: Pick<
    typeof SecureStore,
    'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
  >;
  asyncStorage: typeof AsyncStorage;
  fetch: typeof globalThis.fetch;
  feedback?: Partial<ParentFeedbackDependencies>;
};

const defaultSessionStore = createParentSessionStore({
  secureStore: SecureStore,
  asyncStorage: AsyncStorage,
});

const defaultDependencies: ParentAppDependencies = {
  sessionStore: defaultSessionStore,
  secureStore: SecureStore,
  asyncStorage: AsyncStorage,
  fetch: globalThis.fetch,
};

export function ParentAppProvider({
  children,
  dependencies = defaultDependencies,
}: PropsWithChildren<{ dependencies?: ParentAppDependencies }>) {
  const [session, setSession] = useState<ClientSession>();
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const nextSession = await dependencies.sessionStore.load();
    setSession(nextSession);
    setLoading(false);
  }, [dependencies.sessionStore]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => connectReactNativeQueryManagers(), []);

  const feedbackDependencies = useMemo<ParentFeedbackDependencies>(
    () => ({
      now: dependencies.feedback?.now ?? (() => new Date()),
      randomUUID: dependencies.feedback?.randomUUID ?? createSecureUuid,
      source:
        dependencies.feedback?.source ??
        (Platform.OS === 'android' ? 'PARENT_ANDROID' : 'PARENT_IOS'),
      storage: dependencies.feedback?.storage ?? dependencies.asyncStorage,
      appVersion:
        dependencies.feedback?.appVersion ??
        Constants.expoConfig?.version ??
        'development',
      ...(dependencies.feedback?.retryScheduler
        ? { retryScheduler: dependencies.feedback.retryScheduler }
        : {}),
    }),
    [dependencies.asyncStorage, dependencies.feedback],
  );

  return (
    <ParentFeedbackProvider
      session={session}
      fetch={dependencies.fetch}
      dependencies={feedbackDependencies}
    >
      <ParentSessionProvider
        session={session}
        loading={loading}
        dependencies={dependencies}
        refreshSession={refreshSession}
      >
        {children}
      </ParentSessionProvider>
    </ParentFeedbackProvider>
  );
}

function ParentSessionProvider({
  session,
  loading,
  dependencies,
  refreshSession,
  children,
}: PropsWithChildren<{
  session: ClientSession | undefined;
  loading: boolean;
  dependencies: ParentAppDependencies;
  refreshSession(): Promise<void>;
}>) {
  const { fetch } = useFeedbackRuntime();

  const contextValue = useMemo(
    () => ({
      session,
      loading,
      sessionStore: dependencies.sessionStore,
      fetch,
      refreshSession,
    }),
    [dependencies.sessionStore, fetch, loading, refreshSession, session],
  );

  if (loading) {
    return <ScreenState message="Opening your family…" />;
  }

  return (
    <ParentSessionContext.Provider value={contextValue}>
      {session ? (
        <SessionQueryProvider
          session={session}
          asyncStorage={dependencies.asyncStorage}
        >
          {children}
        </SessionQueryProvider>
      ) : (
        children
      )}
    </ParentSessionContext.Provider>
  );
}

function SessionQueryProvider({
  session,
  asyncStorage,
  children,
}: PropsWithChildren<{
  session: ClientSession;
  asyncStorage: typeof AsyncStorage;
}>) {
  const queryClient = useMemo(
    () => createParentQueryClient(session),
    [session],
  );
  const dehydrateOptions = useMemo(
    () => createParentDehydrateOptions(session),
    [session],
  );
  const persister = useMemo(
    () => createParentQueryPersister(asyncStorage, session),
    [asyncStorage, session],
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: parentQueryCacheBuster(session),
        dehydrateOptions,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
