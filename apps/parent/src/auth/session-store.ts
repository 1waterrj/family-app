import type AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parsePersistedClientSession,
  type ClientSession,
} from '@family/api-client';
import type * as SecureStore from 'expo-secure-store';

import { parentQueryPersistenceKey } from '../query/create-query-client';

export const PARENT_SESSION_TOKEN_KEY = 'family-parent-session-token';
export const PARENT_SESSION_METADATA_KEY = 'family-parent-session-metadata';

type SecureStoreBoundary = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>;

export interface ParentSessionStore {
  load(): Promise<ClientSession | undefined>;
  save(session: ClientSession): Promise<void>;
  clear(): Promise<void>;
}

type SessionMetadata = Omit<ClientSession, 'accessToken'>;

export function createParentSessionStore({
  secureStore,
  asyncStorage,
}: {
  secureStore: SecureStoreBoundary;
  asyncStorage: typeof AsyncStorage;
}): ParentSessionStore {
  async function load(): Promise<ClientSession | undefined> {
    const [accessToken, serializedMetadata] = await Promise.all([
      secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY),
      asyncStorage.getItem(PARENT_SESSION_METADATA_KEY),
    ]);
    if (!accessToken && !serializedMetadata) return undefined;

    const metadata = serializedMetadata
      ? parseMetadata(serializedMetadata)
      : undefined;
    const session = parsePersistedClientSession(
      metadata ? { ...metadata, accessToken } : null,
      'PARENT',
    );
    if (session) return session;

    await Promise.allSettled([
      secureStore.deleteItemAsync(PARENT_SESSION_TOKEN_KEY),
      asyncStorage.removeItem(PARENT_SESSION_METADATA_KEY),
    ]);
    return undefined;
  }

  return {
    load,
    async save(session) {
      const priorSession = await load();
      if (
        priorSession &&
        parentQueryPersistenceKey(priorSession) !==
          parentQueryPersistenceKey(session)
      ) {
        await asyncStorage.removeItem(parentQueryPersistenceKey(priorSession));
      }

      const metadata: SessionMetadata = {
        apiOrigin: session.apiOrigin,
        actorId: session.actorId,
        householdId: session.householdId,
        role: session.role,
      };
      try {
        await secureStore.setItemAsync(
          PARENT_SESSION_TOKEN_KEY,
          session.accessToken,
        );
        await asyncStorage.setItem(
          PARENT_SESSION_METADATA_KEY,
          JSON.stringify(metadata),
        );
      } catch (error) {
        await Promise.allSettled([
          secureStore.deleteItemAsync(PARENT_SESSION_TOKEN_KEY),
          asyncStorage.removeItem(PARENT_SESSION_METADATA_KEY),
        ]);
        throw error;
      }
    },
    async clear() {
      const priorSession = await load();
      const cleanupResults = await Promise.allSettled([
        priorSession
          ? asyncStorage.removeItem(parentQueryPersistenceKey(priorSession))
          : Promise.resolve(),
        secureStore.deleteItemAsync(PARENT_SESSION_TOKEN_KEY),
        asyncStorage.removeItem(PARENT_SESSION_METADATA_KEY),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') throw result.reason;
      }
    },
  };
}

function parseMetadata(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
