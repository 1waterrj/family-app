import { normalizeLocalDevelopmentOrigin } from '@family/contracts';
import { z } from 'zod';

import type { ClientSession } from './client.js';

export const DEVELOPMENT_FIXTURE_TOKEN_CLAIMS_MARKER =
  'development-fixture-token-claims';

const credentialSchema = z
  .object({
    version: z.literal(1),
    apiOrigin: z.string().min(1),
    accessToken: z.string().min(1),
  })
  .strict();

const claimsSchema = z.object({
  actorId: z.uuid(),
  householdId: z.uuid(),
  role: z.enum(['PARENT', 'DASHBOARD']),
});

export type DevelopmentCredential = {
  session: ClientSession;
  trust: 'UNTRUSTED_DEVELOPMENT_FIXTURE';
};

export function parseDevelopmentCredential(
  value: unknown,
): DevelopmentCredential | null {
  const credential = credentialSchema.safeParse(value);
  if (!credential.success) return null;

  const apiOrigin = normalizeLocalDevelopmentOrigin(credential.data.apiOrigin);
  if (!apiOrigin) return null;

  const claims = decodeClaims(credential.data.accessToken);
  if (!claims) return null;

  return {
    session: {
      apiOrigin,
      accessToken: credential.data.accessToken,
      actorId: claims.actorId,
      householdId: claims.householdId,
      role: claims.role,
    },
    trust: 'UNTRUSTED_DEVELOPMENT_FIXTURE',
  };
}

function decodeClaims(accessToken: string) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) return null;
  const [encodedClaims] = accessToken.split('.');

  try {
    const base64 = encodedClaims.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    );
    const claims = claimsSchema.safeParse(JSON.parse(json));
    return claims.success ? claims.data : null;
  } catch {
    return null;
  }
}
