import type { ClientSession } from '@family/api-client';
import { createContext, useContext } from 'react';

import type { ParentSessionStore } from './session-store';

export type ParentSessionContextValue = {
  session: ClientSession | undefined;
  loading: boolean;
  sessionStore: ParentSessionStore;
  fetch: typeof globalThis.fetch;
  refreshSession(): Promise<void>;
};

export const ParentSessionContext =
  createContext<ParentSessionContextValue | null>(null);

export function useSession(): ParentSessionContextValue {
  const value = useContext(ParentSessionContext);
  if (!value) {
    throw new Error('useSession must be used inside ParentAppProvider');
  }
  return value;
}
