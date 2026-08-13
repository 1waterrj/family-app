import type { ActorContext } from './auth/actor-context.js';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly code: 'UNAUTHORIZED' | 'VALIDATION_ERROR',
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function parseRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
  pathForIssue: (path: PropertyKey[]) => string,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const path = pathForIssue([...issue.path, key]);
        (fieldErrors[path] ??= []).push(`Unrecognized key: "${key}"`);
      }
      continue;
    }
    const path = pathForIssue(issue.path);
    (fieldErrors[path] ??= []).push(issue.message);
  }
  throw new HttpError(
    'VALIDATION_ERROR',
    'The request is invalid.',
    fieldErrors,
  );
}

export function requestActor(request: FastifyRequest): ActorContext {
  if (!request.actor) {
    throw new HttpError('UNAUTHORIZED', 'Authentication is required.');
  }
  return request.actor;
}

export function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

export function requestPath(location: string) {
  return (path: PropertyKey[]): string =>
    [location, ...path.map(String)].join('.');
}

export function commandPath(path: PropertyKey[]): string {
  const [first, ...rest] = path.map(String);
  if (first === 'idempotencyKey') {
    return 'headers.idempotency-key';
  }
  if (first === 'choreInstanceId') {
    return 'path.id';
  }
  return ['body', first, ...rest].filter(Boolean).join('.');
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: ActorContext;
  }
}
