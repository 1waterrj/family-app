import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  type ApiErrorCode,
  HealthStatusSchema,
} from '@family/contracts';
import { sql } from 'drizzle-orm';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyLoggerOptions,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from 'fastify';

import {
  ActorContextError,
  type ActorAuthenticator,
  DevelopmentActorAuthenticator,
} from './auth/actor-context.js';
import { choreRoutes } from './chores/routes.js';
import {
  ChoreService,
  ChoreServiceError,
  type Clock,
} from './chores/service.js';
import {
  DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS,
  parseFeedbackGithubRepositoryUrl,
} from './config.js';
import type { Database } from './db/client.js';
import { feedbackRoutes } from './feedback/routes.js';
import { FeedbackService, FeedbackServiceError } from './feedback/service.js';
import { householdRoutes } from './households/routes.js';
import { HouseholdService } from './households/service.js';
import { HttpError } from './http.js';
import { IdempotencyConflictError } from './idempotency/executor.js';
import { ledgerRoutes } from './ledger/routes.js';
import { LedgerService, LedgerServiceError } from './ledger/service.js';
import { snapshotRoutes } from './snapshots/routes.js';
import { SnapshotService } from './snapshots/service.js';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface BuildAppOptions {
  database: Database;
  nodeEnv: NodeEnvironment;
  developmentAuthSecret?: string;
  actorAuthenticator?: ActorAuthenticator;
  clock?: Clock;
  householdPayoutCeilingCents?: number;
  feedbackGithubRepository?: string;
  logger?: boolean | FastifyLoggerOptions;
}

const systemClock: Clock = {
  now: () => new Date(),
};

export function buildApp({
  database,
  nodeEnv,
  developmentAuthSecret,
  actorAuthenticator,
  clock = systemClock,
  householdPayoutCeilingCents = DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS,
  feedbackGithubRepository,
  logger = false,
}: BuildAppOptions): FastifyInstance {
  const authenticator = resolveAuthenticator(
    nodeEnv,
    developmentAuthSecret,
    actorAuthenticator,
  );
  const app = Fastify({
    bodyLimit: 64 * 1_024,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: !logger }),
    logger,
  });

  app.setErrorHandler(handleError);
  app.setNotFoundHandler((request, reply) =>
    sendError(reply, request, 'NOT_FOUND', 'Resource not found.', 404),
  );

  app.get('/health/live', async () =>
    HealthStatusSchema.parse({ status: 'ok' }),
  );
  app.get('/health/ready', async (request, reply) => {
    try {
      await database.execute(sql`select 1`);
      return HealthStatusSchema.parse({ status: 'ok' });
    } catch {
      logRequestFailure(request, 'Database readiness check failed.');
      return sendError(
        reply,
        request,
        'INTERNAL_ERROR',
        'The service is not ready.',
        503,
      );
    }
  });

  const householdService = new HouseholdService(database);
  const choreService = new ChoreService(
    database,
    clock,
    undefined,
    undefined,
    householdPayoutCeilingCents,
  );
  const ledgerService = new LedgerService(database);
  const snapshotService = new SnapshotService(database, clock);
  const configuredFeedbackRepository =
    feedbackGithubRepository === undefined
      ? undefined
      : parseFeedbackGithubRepositoryUrl(feedbackGithubRepository);
  const feedbackService = new FeedbackService(
    database,
    clock,
    configuredFeedbackRepository,
  );

  app.register(
    async (versioned) => {
      versioned.addHook('onRequest', async (request) => {
        const actor = await authenticator.authenticate(
          request.headers.authorization,
        );
        if (!actor) {
          throw new HttpError('UNAUTHORIZED', 'Authentication is required.');
        }
        request.actor = actor;
      });
      await versioned.register(householdRoutes, { householdService });
      await versioned.register(choreRoutes, { choreService });
      await versioned.register(ledgerRoutes, { ledgerService });
      await versioned.register(snapshotRoutes, { snapshotService });
      await versioned.register(feedbackRoutes, { feedbackService });
    },
    { prefix: '/v1' },
  );

  return app;
}

function resolveAuthenticator(
  nodeEnv: NodeEnvironment,
  developmentAuthSecret: string | undefined,
  configured: ActorAuthenticator | undefined,
): ActorAuthenticator {
  if (nodeEnv === 'production') {
    if (!configured) {
      throw new Error(
        'A real production actor authenticator must be configured before startup.',
      );
    }
    if (configured.kind === 'development-fixture') {
      throw new Error(
        'Development fixture authentication is forbidden in production.',
      );
    }
    return configured;
  }

  if (configured) {
    return configured;
  }
  if (!developmentAuthSecret) {
    throw new Error(
      'DEVELOPMENT_AUTH_SECRET must be explicitly configured outside production.',
    );
  }
  return new DevelopmentActorAuthenticator(developmentAuthSecret);
}

function handleError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    sendError(
      reply,
      request,
      error.code,
      error.message,
      error.code === 'UNAUTHORIZED' ? 401 : 400,
      error.fieldErrors,
    );
    return;
  }

  if (error instanceof ActorContextError) {
    const status = error.code === 'FORBIDDEN' ? 403 : 404;
    sendError(reply, request, error.code, error.message, status);
    return;
  }

  if (error instanceof ChoreServiceError) {
    const status = error.code === 'VALIDATION_ERROR' ? 400 : 409;
    sendError(reply, request, error.code, error.message, status);
    return;
  }

  if (error instanceof LedgerServiceError) {
    sendError(reply, request, error.code, error.message, 400);
    return;
  }

  if (error instanceof FeedbackServiceError) {
    const status =
      error.code === 'RATE_LIMITED'
        ? 429
        : error.code === 'INVALID_STATE' || error.code === 'CONFLICT'
          ? 409
          : 400;
    sendError(
      reply,
      request,
      error.code,
      error.message,
      status,
      error.fieldErrors,
    );
    return;
  }

  if (error instanceof IdempotencyConflictError) {
    sendError(reply, request, error.code, error.message, 409);
    return;
  }

  const fastifyError = error as FastifyError;
  if (
    fastifyError.statusCode === 413 ||
    fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
  ) {
    sendError(
      reply,
      request,
      'PAYLOAD_TOO_LARGE',
      'The request payload is too large.',
      413,
    );
    return;
  }

  if (
    fastifyError.statusCode === 415 ||
    fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
  ) {
    sendError(
      reply,
      request,
      'UNSUPPORTED_MEDIA_TYPE',
      'The request media type is not supported.',
      415,
    );
    return;
  }

  if (
    fastifyError.statusCode === 400 ||
    fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  ) {
    sendError(
      reply,
      request,
      'VALIDATION_ERROR',
      'The request is invalid.',
      400,
    );
    return;
  }

  logRequestFailure(request, 'Unhandled API error.');
  sendError(
    reply,
    request,
    'INTERNAL_ERROR',
    'An internal error occurred.',
    500,
  );
}

function logRequestFailure(request: FastifyRequest, message: string): void {
  request.log.error(
    {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
    },
    message,
  );
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ApiErrorCode,
  message: string,
  statusCode: number,
  fieldErrors?: Record<string, string[]>,
): void {
  const body = ApiErrorSchema.parse({
    code,
    message,
    requestId: request.id,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
  void reply.code(statusCode).send(body);
}
