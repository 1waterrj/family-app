import {
  CreateFeedbackCommandSchema,
  DeleteFeedbackCommandSchema,
  DeletedFeedbackSchema,
  FeedbackIdSchema,
  FeedbackListItemSchema,
  FeedbackPublicPreviewRequestSchema,
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  FeedbackSubmissionReceiptSchema,
  UpdateFeedbackCommandSchema,
} from '@family/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { parseRequest, requestActor, requestPath } from '../http.js';
import type { FeedbackService } from './service.js';

export interface FeedbackRoutesOptions {
  feedbackService: FeedbackService;
}

const createBodySchema = CreateFeedbackCommandSchema.omit({
  idempotencyKey: true,
});
const updateBodySchema = UpdateFeedbackCommandSchema.omit({
  idempotencyKey: true,
});
const idempotencyHeaderSchema = z.object({ idempotencyKey: z.uuid() }).strict();
const feedbackParamsSchema = z.object({ id: FeedbackIdSchema }).strict();
const emptyObjectSchema = z.object({}).strict();

export const feedbackRoutes: FastifyPluginAsync<FeedbackRoutesOptions> = async (
  app,
  { feedbackService },
) => {
  app.post('/feedback', async (request, reply) => {
    const actor = requestActor(request);
    parseEmptyQuery(request);
    const body = parseRequest(
      createBodySchema,
      requestBody(request),
      requestPath('body'),
    );
    const { idempotencyKey } = parseIdempotencyHeader(request);
    const receipt = await feedbackService.createFeedback(
      actor,
      CreateFeedbackCommandSchema.parse({ ...body, idempotencyKey }),
    );
    return reply.code(201).send(FeedbackSubmissionReceiptSchema.parse(receipt));
  });

  app.get('/feedback', async (request) => {
    const actor = requestActor(request);
    parseEmptyQuery(request);
    return z
      .array(FeedbackListItemSchema)
      .parse(await feedbackService.listFeedback(actor));
  });

  app.get('/feedback/:id', async (request) => {
    const actor = requestActor(request);
    const { id } = parseFeedbackParams(request);
    parseEmptyQuery(request);
    return FeedbackReportSchema.parse(
      await feedbackService.getFeedback(actor, id),
    );
  });

  app.post('/feedback/:id/public-preview', async (request) => {
    const actor = requestActor(request);
    const { id } = parseFeedbackParams(request);
    parseEmptyQuery(request);
    const body = parseRequest(
      FeedbackPublicPreviewRequestSchema,
      requestBody(request),
      requestPath('body'),
    );
    return FeedbackPublicPreviewSchema.parse(
      await feedbackService.preparePublicPreview(actor, id, body),
    );
  });

  app.patch('/feedback/:id', async (request) => {
    const actor = requestActor(request);
    parseEmptyQuery(request);
    const { id } = parseFeedbackParams(request);
    const body = parseRequest(
      updateBodySchema,
      requestBody(request),
      requestPath('body'),
    );
    const { idempotencyKey } = parseIdempotencyHeader(request);
    return FeedbackReportSchema.parse(
      await feedbackService.updateFeedback(
        actor,
        id,
        UpdateFeedbackCommandSchema.parse({ ...body, idempotencyKey }),
      ),
    );
  });

  app.delete('/feedback/:id', async (request) => {
    const actor = requestActor(request);
    parseEmptyQuery(request);
    const { id } = parseFeedbackParams(request);
    parseRequest(emptyObjectSchema, requestBody(request), requestPath('body'));
    const { idempotencyKey } = parseIdempotencyHeader(request);
    return DeletedFeedbackSchema.parse(
      await feedbackService.deleteFeedback(
        actor,
        id,
        DeleteFeedbackCommandSchema.parse({ idempotencyKey }),
      ),
    );
  });
};

function parseFeedbackParams(request: FastifyRequest) {
  return parseRequest(
    feedbackParamsSchema,
    request.params,
    requestPath('path'),
  );
}

function parseIdempotencyHeader(request: FastifyRequest) {
  return parseRequest(
    idempotencyHeaderSchema,
    { idempotencyKey: request.headers['idempotency-key'] },
    () => 'headers.idempotency-key',
  );
}

function parseEmptyQuery(request: FastifyRequest): void {
  parseRequest(emptyObjectSchema, request.query, requestPath('query'));
}

function requestBody(request: FastifyRequest): unknown {
  return request.body === undefined ? {} : request.body;
}
