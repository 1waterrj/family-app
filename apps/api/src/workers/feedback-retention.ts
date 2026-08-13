import { and, asc, eq, inArray, lt } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { feedbackReports } from '../db/schema.js';
import { FeedbackRepository } from '../feedback/repository.js';

export const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FEEDBACK_RETENTION_BATCH_SIZE = 500;
export const FEEDBACK_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const minimumBatchSize = 1;
const feedbackRepository = new FeedbackRepository();

export async function deleteClosedFeedbackBefore(
  database: Database,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < minimumBatchSize ||
    batchSize > FEEDBACK_RETENTION_BATCH_SIZE
  ) {
    throw new RangeError(
      `batchSize must be an integer between ${minimumBatchSize} and ${FEEDBACK_RETENTION_BATCH_SIZE}.`,
    );
  }
  if (Number.isNaN(cutoff.getTime())) {
    throw new RangeError('cutoff must be a valid date.');
  }

  return database.transaction(async (transaction) => {
    const expired = await transaction
      .select({
        id: feedbackReports.id,
        householdId: feedbackReports.householdId,
      })
      .from(feedbackReports)
      .where(
        and(
          eq(feedbackReports.status, 'CLOSED'),
          lt(feedbackReports.closedAt, cutoff),
        ),
      )
      .orderBy(asc(feedbackReports.closedAt), asc(feedbackReports.id))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (expired.length === 0) return 0;

    await feedbackRepository.deleteUpdateReplaysForReports(
      transaction,
      expired.map(({ householdId, id }) => ({
        householdId,
        reportId: id,
      })),
    );

    const deleted = await transaction
      .delete(feedbackReports)
      .where(
        and(
          eq(feedbackReports.status, 'CLOSED'),
          lt(feedbackReports.closedAt, cutoff),
          inArray(
            feedbackReports.id,
            expired.map(({ id }) => id),
          ),
        ),
      )
      .returning({ id: feedbackReports.id });
    return deleted.length;
  });
}

export interface FeedbackRetentionLog {
  info(metadata: { deletedCount: number }, message: string): void;
  error(metadata: { errorCategory: string }, message: string): void;
}

export interface StartFeedbackRetentionWorkerOptions {
  database: Database;
  intervalMs: number;
  retentionMs: number;
  batchSize: number;
  log: FeedbackRetentionLog;
}

export interface FeedbackRetentionWorker {
  initialCleanup: Promise<void>;
  stop(): Promise<void>;
}

export function startFeedbackRetentionWorker({
  database,
  intervalMs,
  retentionMs,
  batchSize,
  log,
}: StartFeedbackRetentionWorkerOptions): FeedbackRetentionWorker {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be positive.');
  }
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new RangeError('retentionMs must be positive.');
  }

  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const runCleanup = (): Promise<void> => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    const cleanup = (async () => {
      try {
        const cutoff = new Date(Date.now() - retentionMs);
        const deletedCount = await deleteClosedFeedbackBefore(
          database,
          cutoff,
          batchSize,
        );
        log.info({ deletedCount }, 'Feedback retention cleanup completed.');
      } catch {
        log.error(
          { errorCategory: 'RETENTION_CLEANUP_FAILED' },
          'Feedback retention cleanup failed.',
        );
      }
    })();
    inFlight = cleanup;
    void cleanup.finally(() => {
      if (inFlight === cleanup) inFlight = undefined;
    });
    return cleanup;
  };

  const initialCleanup = runCleanup();
  const timer = setInterval(() => {
    void runCleanup();
  }, intervalMs);
  timer.unref();

  return {
    initialCleanup,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
