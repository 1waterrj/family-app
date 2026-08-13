import type { ClientSession } from '@family/api-client';

import {
  createParentSessionStore,
  PARENT_SESSION_METADATA_KEY,
  PARENT_SESSION_TOKEN_KEY,
} from '../src/auth/session-store';
import { parentQueryPersistenceKey } from '../src/query/create-query-client';
import {
  createMemoryAsyncStorage,
  createMemorySecureStore,
} from './test-adapters';

const primaryParent: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

describe('parent session storage', () => {
  test('keeps the access token in secure storage and restores a complete session', async () => {
    const secureStore = createMemorySecureStore();
    const asyncStorage = createMemoryAsyncStorage();
    const store = createParentSessionStore({ secureStore, asyncStorage });

    await store.save(primaryParent);

    expect(await store.load()).toEqual(primaryParent);
    expect(await asyncStorage.getItem(PARENT_SESSION_METADATA_KEY)).toBe(
      JSON.stringify({
        apiOrigin: 'http://127.0.0.1:3000',
        actorId: '10000000-0000-4000-8000-000000000001',
        householdId: '20000000-0000-4000-8000-000000000001',
        role: 'PARENT',
      }),
    );
    expect(await asyncStorage.getItem(PARENT_SESSION_TOKEN_KEY)).toBeNull();
    expect(await secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY)).toBe(
      'parent-secret',
    );
  });

  test('normalizes valid restored local metadata', async () => {
    const secureStore = createMemorySecureStore();
    const asyncStorage = createMemoryAsyncStorage();
    await secureStore.setItemAsync(PARENT_SESSION_TOKEN_KEY, 'parent-secret');
    await asyncStorage.setItem(
      PARENT_SESSION_METADATA_KEY,
      JSON.stringify({
        apiOrigin: 'HTTP://LOCALHOST:80/',
        actorId: primaryParent.actorId,
        householdId: primaryParent.householdId,
        role: primaryParent.role,
      }),
    );
    const store = createParentSessionStore({ secureStore, asyncStorage });

    await expect(store.load()).resolves.toEqual({
      ...primaryParent,
      apiOrigin: 'http://localhost',
    });
  });

  test.each([
    ['public origin', { apiOrigin: 'https://family.example.test' }],
    ['deceptive origin', { apiOrigin: 'http://localhost.example.com' }],
    ['malformed actor id', { actorId: 'not-a-uuid' }],
    ['malformed household id', { householdId: 'not-a-uuid' }],
    ['wrong role', { role: 'DASHBOARD' }],
  ])(
    'fails closed and scrubs restored metadata with a %s',
    async (_case, override) => {
      const secureStore = createMemorySecureStore();
      const asyncStorage = createMemoryAsyncStorage();
      await secureStore.setItemAsync(PARENT_SESSION_TOKEN_KEY, 'parent-secret');
      await asyncStorage.setItem(
        PARENT_SESSION_METADATA_KEY,
        JSON.stringify({ ...parentMetadata(), ...override }),
      );
      const store = createParentSessionStore({ secureStore, asyncStorage });

      await expect(store.load()).resolves.toBeUndefined();
      expect(
        await secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY),
      ).toBeNull();
      expect(
        await asyncStorage.getItem(PARENT_SESSION_METADATA_KEY),
      ).toBeNull();
    },
  );

  test('fails closed and scrubs an empty restored token', async () => {
    const secureStore = createMemorySecureStore();
    const asyncStorage = createMemoryAsyncStorage();
    await secureStore.setItemAsync(PARENT_SESSION_TOKEN_KEY, '');
    await asyncStorage.setItem(
      PARENT_SESSION_METADATA_KEY,
      JSON.stringify(parentMetadata()),
    );
    const store = createParentSessionStore({ secureStore, asyncStorage });

    await expect(store.load()).resolves.toBeUndefined();
    expect(await secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY)).toBeNull();
    expect(await asyncStorage.getItem(PARENT_SESSION_METADATA_KEY)).toBeNull();
  });

  test('removes the prior actor persisted query cache before saving an actor change', async () => {
    const secureStore = createMemorySecureStore();
    const asyncStorage = createMemoryAsyncStorage();
    const store = createParentSessionStore({ secureStore, asyncStorage });
    const nextParent = {
      ...primaryParent,
      accessToken: 'next-parent-secret',
      actorId: '10000000-0000-4000-8000-000000000003',
    };
    const oldCacheKey = parentQueryPersistenceKey(primaryParent);

    await store.save(primaryParent);
    await asyncStorage.setItem(oldCacheKey, 'private cached snapshot');
    await store.save(nextParent);

    expect(await asyncStorage.getItem(oldCacheKey)).toBeNull();
    expect(await store.load()).toEqual(nextParent);
  });

  test('clears secure and non-secret session state plus its owned query cache', async () => {
    const secureStore = createMemorySecureStore();
    const asyncStorage = createMemoryAsyncStorage();
    const store = createParentSessionStore({ secureStore, asyncStorage });
    const cacheKey = parentQueryPersistenceKey(primaryParent);

    await store.save(primaryParent);
    await asyncStorage.setItem(cacheKey, 'private cached snapshot');
    await store.clear();

    expect(await store.load()).toBeUndefined();
    expect(await secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY)).toBeNull();
    expect(await asyncStorage.getItem(PARENT_SESSION_METADATA_KEY)).toBeNull();
    expect(await asyncStorage.getItem(cacheKey)).toBeNull();
  });

  test('clears credentials even when its persisted query cache cannot be removed', async () => {
    const underlyingSecureStore = createMemorySecureStore();
    const secureStore = {
      ...underlyingSecureStore,
      deleteItemAsync: async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await underlyingSecureStore.deleteItemAsync(key);
      },
    };
    const underlyingStorage = createMemoryAsyncStorage();
    const cacheKey = parentQueryPersistenceKey(primaryParent);
    const failingStorage = {
      ...underlyingStorage,
      removeItem: async (key: string) => {
        if (key === cacheKey) throw new Error('cache unavailable');
        await underlyingStorage.removeItem(key);
      },
    };
    const store = createParentSessionStore({
      secureStore,
      asyncStorage: failingStorage,
    });

    await store.save(primaryParent);
    await underlyingStorage.setItem(cacheKey, 'private cached snapshot');

    try {
      await expect(store.clear()).rejects.toThrow('cache unavailable');

      expect(
        await underlyingSecureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY),
      ).toBeNull();
      expect(
        await underlyingStorage.getItem(PARENT_SESSION_METADATA_KEY),
      ).toBeNull();
      expect(await underlyingStorage.getItem(cacheKey)).toBe(
        'private cached snapshot',
      );
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  });

  test('fails closed when non-secret metadata cannot be saved after the token', async () => {
    const secureStore = createMemorySecureStore();
    const underlyingStorage = createMemoryAsyncStorage();
    const failingStorage = {
      ...underlyingStorage,
      setItem: async (key: string, value: string) => {
        if (key === PARENT_SESSION_METADATA_KEY) {
          throw new Error('storage unavailable');
        }
        await underlyingStorage.setItem(key, value);
      },
    };
    const store = createParentSessionStore({
      secureStore,
      asyncStorage: failingStorage,
    });

    await expect(store.save(primaryParent)).rejects.toThrow(
      'storage unavailable',
    );

    expect(await secureStore.getItemAsync(PARENT_SESSION_TOKEN_KEY)).toBeNull();
    expect(
      await underlyingStorage.getItem(PARENT_SESSION_METADATA_KEY),
    ).toBeNull();
  });
});

function parentMetadata() {
  return {
    apiOrigin: primaryParent.apiOrigin,
    actorId: primaryParent.actorId,
    householdId: primaryParent.householdId,
    role: primaryParent.role,
  };
}
