import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ActorRole } from '@family/contracts';
import { z } from 'zod';

type ParentActorRole = Extract<ActorRole, 'PARENT'>;
type DashboardActorRole = Extract<ActorRole, 'DASHBOARD'>;

export type ActorContext =
  | { role: ParentActorRole; actorId: string; householdId: string }
  | { role: DashboardActorRole; actorId: string; householdId: string };

export type ParentActorContext = Extract<ActorContext, { role: 'PARENT' }>;
export type DashboardActorContext = Extract<
  ActorContext,
  { role: 'DASHBOARD' }
>;

export interface ActorAuthenticator {
  readonly kind?: string;
  authenticate(
    authorizationHeader: string | undefined,
  ): Promise<ActorContext | undefined>;
}

const developmentTokenClaimsSchema = z.object({
  version: z.literal(1),
  role: z.enum(['PARENT', 'DASHBOARD']),
  actorId: z.uuid(),
  householdId: z.uuid(),
});

const minimumDevelopmentSecretBytes = 32;

export class DevelopmentActorAuthenticator implements ActorAuthenticator {
  readonly kind = 'development-fixture';

  constructor(private readonly secret: string) {
    assertStrongDevelopmentSecret(secret);
  }

  async authenticate(
    authorizationHeader: string | undefined,
  ): Promise<ActorContext | undefined> {
    const token = bearerToken(authorizationHeader);
    if (!token) {
      return undefined;
    }

    const [encodedClaims, encodedSignature, extraPart] = token.split('.');
    if (!encodedClaims || !encodedSignature || extraPart !== undefined) {
      return undefined;
    }

    const expectedSignature = sign(encodedClaims, this.secret);
    const provided = Buffer.from(encodedSignature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return undefined;
    }

    try {
      const claims = developmentTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')),
      );
      return {
        role: claims.role,
        actorId: claims.actorId,
        householdId: claims.householdId,
      };
    } catch {
      return undefined;
    }
  }
}

export function issueDevelopmentActorToken(
  actor: ActorContext,
  secret: string,
): string {
  assertStrongDevelopmentSecret(secret);
  const claims = developmentTokenClaimsSchema.parse({
    version: 1,
    ...actor,
  });
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
    'base64url',
  );
  return `${encodedClaims}.${sign(encodedClaims, secret)}`;
}

export class ActorContextError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ActorContextError';
  }
}

export function requireParent(actor: ActorContext): ParentActorContext {
  if (actor.role !== 'PARENT') {
    throw new ActorContextError(
      'FORBIDDEN',
      'This operation requires a parent actor.',
    );
  }

  return actor;
}

export function requireDashboard(actor: ActorContext): DashboardActorContext {
  if (actor.role !== 'DASHBOARD') {
    throw new ActorContextError(
      'FORBIDDEN',
      'This operation requires a dashboard actor.',
    );
  }

  return actor;
}

export function assertHousehold(
  actor: ActorContext,
  householdId: string,
): void {
  if (actor.householdId !== householdId) {
    throw new ActorContextError('NOT_FOUND', 'Resource not found.');
  }
}

function assertStrongDevelopmentSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < minimumDevelopmentSecretBytes) {
    throw new Error(
      `Development authentication secret must be at least ${minimumDevelopmentSecretBytes} bytes.`,
    );
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
  return match?.[1];
}

function sign(encodedClaims: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(encodedClaims, 'utf8')
    .digest('base64url');
}
