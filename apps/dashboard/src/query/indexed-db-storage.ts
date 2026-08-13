import { del, get, set } from 'idb-keyval';

const INDEXED_DB_COORDINATION_IDENTITY = {};

export interface AsyncKeyValueStore {
  coordinationIdentity?: object;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createIndexedDbStorage(): AsyncKeyValueStore {
  return {
    coordinationIdentity: INDEXED_DB_COORDINATION_IDENTITY,
    async getItem(key) {
      return (await get<string>(key)) ?? null;
    },
    async setItem(key, value) {
      await set(key, value);
    },
    async removeItem(key) {
      await del(key);
    },
  };
}

export function createBrowserStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): AsyncKeyValueStore {
  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => storage.setItem(key, value),
    removeItem: async (key) => storage.removeItem(key),
  };
}
