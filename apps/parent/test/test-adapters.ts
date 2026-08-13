import type AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SecureStore from 'expo-secure-store';

export type AsyncStorageLike = typeof AsyncStorage;
export type SecureStoreLike = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>;

export function createMemoryAsyncStorage(): AsyncStorageLike {
  const values = new Map<string, string>();

  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    mergeItem: async (key, value) => {
      const current = values.get(key);
      values.set(
        key,
        JSON.stringify({
          ...(current ? (JSON.parse(current) as object) : {}),
          ...(JSON.parse(value) as object),
        }),
      );
    },
    clear: async () => {
      values.clear();
    },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys) => keys.map((key) => [key, values.get(key) ?? null]),
    multiSet: async (entries) => {
      for (const [key, value] of entries) values.set(key, value);
    },
    multiRemove: async (keys) => {
      for (const key of keys) values.delete(key);
    },
    multiMerge: async (entries) => {
      for (const [key, value] of entries) {
        const current = values.get(key);
        values.set(
          key,
          JSON.stringify({
            ...(current ? (JSON.parse(current) as object) : {}),
            ...(JSON.parse(value) as object),
          }),
        );
      }
    },
    flushGetRequests: () => undefined,
  } as AsyncStorageLike;
}

export function createMemorySecureStore(): SecureStoreLike {
  const values = new Map<string, string>();

  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
}

export function encodeDevelopmentCredential(
  role: 'PARENT' | 'DASHBOARD',
  overrides: { actorId?: string; accessToken?: string } = {},
) {
  const claims = {
    actorId:
      overrides.actorId ??
      (role === 'PARENT'
        ? '10000000-0000-4000-8000-000000000001'
        : '10000000-0000-4000-8000-000000000002'),
    householdId: '20000000-0000-4000-8000-000000000001',
    role,
  };
  const encodedClaims = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return JSON.stringify({
    version: 1,
    apiOrigin: 'http://127.0.0.1:3000',
    accessToken: overrides.accessToken ?? `${encodedClaims}.development`,
  });
}
