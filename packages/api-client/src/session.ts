import { normalizeLocalDevelopmentOrigin } from '@family/contracts';
import { z } from 'zod';

import type { ClientSession } from './client.js';

const persistedSessionSchema = z
  .object({
    apiOrigin: z.string().min(1),
    accessToken: z.string().min(1),
    actorId: z.uuid(),
    householdId: z.uuid(),
    role: z.enum(['PARENT', 'DASHBOARD']),
  })
  .strict();

export function parsePersistedClientSession(
  value: unknown,
  requiredRole: ClientSession['role'],
): ClientSession | null {
  const parsed = persistedSessionSchema.safeParse(value);
  if (!parsed.success || parsed.data.role !== requiredRole) return null;

  const apiOrigin = normalizeLocalDevelopmentOrigin(parsed.data.apiOrigin);
  return apiOrigin ? { ...parsed.data, apiOrigin } : null;
}
