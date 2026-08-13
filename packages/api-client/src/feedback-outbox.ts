import {
  CreateFeedbackCommandSchema,
  FeedbackSubmissionReceiptSchema,
  type CreateFeedbackCommand,
  type FeedbackSubmissionReceipt,
} from '@family/contracts';
import { z } from 'zod';

import { createSecureUuid } from './secure-uuid.js';

export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface FeedbackOutboxEntry {
  id: string;
  command: CreateFeedbackCommand;
  scope: string | null;
  createdAt: string;
  deliveryState: 'QUEUED' | 'DELIVERY_ATTEMPTED';
}

export type FeedbackOutboxRemoveResult =
  'removedUnsent' | 'alreadyDelivered' | 'deliveryUnknown' | 'notFound';

export interface FeedbackOutbox {
  enqueue(command: CreateFeedbackCommand, scope?: string): Promise<string>;
  bindUnscoped(scope: string): Promise<void>;
  list(): Promise<readonly FeedbackOutboxEntry[]>;
  flush(options: {
    scope: string;
    bindUnscoped?: boolean;
    deliver(command: CreateFeedbackCommand): Promise<FeedbackSubmissionReceipt>;
  }): Promise<{ deliveredEntryIds: string[]; stoppedOnError: boolean }>;
  remove(
    entryId: string,
    allowedScope?: string,
  ): Promise<FeedbackOutboxRemoveResult>;
  dispose(): void;
}

export interface FeedbackOutboxOptions {
  storage: StringStorage;
  key: string;
  coordinationIdentity?: object;
  expiresAfterMs?: number;
  now?: () => number;
  randomUUID?: () => string;
}

const QueuedFeedbackOutboxEntrySchema = z
  .object({
    id: z.uuid(),
    command: CreateFeedbackCommandSchema,
    scope: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    deliveryState: z
      .enum(['QUEUED', 'DELIVERY_ATTEMPTED'])
      .optional()
      .default('QUEUED'),
    deliveryAttemptId: z.uuid().optional(),
  })
  .strict();
const DeliveredFeedbackOutboxEntrySchema = z
  .object({
    id: z.uuid(),
    scope: z.string().trim().min(1).nullable(),
    createdAt: z.iso.datetime(),
    deliveryState: z.literal('DELIVERED_PENDING_CLEANUP'),
  })
  .strict();
const FeedbackOutboxEntriesSchema = z.array(
  z.union([
    QueuedFeedbackOutboxEntrySchema,
    DeliveredFeedbackOutboxEntrySchema,
  ]),
);
const FeedbackOutboxScopeSchema = z.string().trim().min(1);

type StoredFeedbackOutboxEntry = z.infer<
  typeof FeedbackOutboxEntriesSchema
>[number];

interface StorageQueue {
  tail: Promise<void>;
  acknowledgedEntryIds: Set<string>;
  activeAttempts: Map<string, string>;
  references: number;
}

const storageQueues = new WeakMap<object, Map<string, StorageQueue>>();

function storageQueue(identity: object, key: string): StorageQueue {
  let queues = storageQueues.get(identity);
  if (!queues) {
    queues = new Map();
    storageQueues.set(identity, queues);
  }
  let queue = queues.get(key);
  if (!queue) {
    queue = {
      tail: Promise.resolve(),
      acknowledgedEntryIds: new Set(),
      activeAttempts: new Map(),
      references: 0,
    };
    queues.set(key, queue);
  }
  queue.references += 1;
  return queue;
}

function releaseStorageQueue(
  identity: object,
  key: string,
  queue: StorageQueue,
): void {
  queue.references -= 1;
  scheduleQueueCleanup(identity, key, queue);
}

function scheduleQueueCleanup(
  identity: object,
  key: string,
  queue: StorageQueue,
): void {
  void queue.tail.finally(() => {
    const queues = storageQueues.get(identity);
    if (
      queues?.get(key) !== queue ||
      queue.references !== 0 ||
      queue.activeAttempts.size !== 0
    ) {
      return;
    }
    queues.delete(key);
    if (queues.size === 0) storageQueues.delete(identity);
  });
}

export function createFeedbackOutbox(
  options: FeedbackOutboxOptions,
): FeedbackOutbox {
  const now = options.now ?? Date.now;
  const randomUUID = options.randomUUID ?? createSecureUuid;
  const coordinationIdentity = options.coordinationIdentity ?? options.storage;
  const queue = storageQueue(coordinationIdentity, options.key);
  let disposed = false;

  function assertActive(): void {
    if (disposed) throw new Error('Feedback outbox has been disposed.');
  }

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.tail.then(work, work);
    queue.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function readEntries(): Promise<StoredFeedbackOutboxEntry[]> {
    const stored = await options.storage.getItem(options.key);
    if (stored === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      await options.storage.removeItem(options.key);
      return [];
    }
    const entries = FeedbackOutboxEntriesSchema.safeParse(parsed);
    if (!entries.success) {
      await options.storage.removeItem(options.key);
      return [];
    }
    return entries.data;
  }

  async function saveEntries(
    entries: readonly StoredFeedbackOutboxEntry[],
  ): Promise<void> {
    if (entries.length === 0) {
      await options.storage.removeItem(options.key);
      return;
    }
    await options.storage.setItem(options.key, JSON.stringify(entries));
  }

  function withoutExpired(
    entries: readonly StoredFeedbackOutboxEntry[],
  ): StoredFeedbackOutboxEntry[] {
    if (options.expiresAfterMs === undefined) return [...entries];
    const cutoff = now() - options.expiresAfterMs;
    return entries.filter((entry) => Date.parse(entry.createdAt) >= cutoff);
  }

  async function readAndPrune(): Promise<StoredFeedbackOutboxEntry[]> {
    const entries = await readEntries();
    const retained = withoutExpired(entries);
    if (retained.length !== entries.length) await saveEntries(retained);
    return retained;
  }

  return {
    enqueue(command, scope) {
      assertActive();
      return serialize(async () => {
        const validatedScope =
          scope === undefined ? null : FeedbackOutboxScopeSchema.parse(scope);
        const entry: FeedbackOutboxEntry = {
          id: randomUUID(),
          command: CreateFeedbackCommandSchema.parse(command),
          scope: validatedScope,
          createdAt: new Date(now()).toISOString(),
          deliveryState: 'QUEUED',
        };
        const entries = await readAndPrune();
        entries.push(entry);
        await saveEntries(entries);
        return entry.id;
      });
    },
    bindUnscoped(scope) {
      assertActive();
      return serialize(async () => {
        const validatedScope = FeedbackOutboxScopeSchema.parse(scope);
        const entries = await readAndPrune();
        if (!entries.some((entry) => entry.scope === null)) return;
        await saveEntries(
          entries.map((entry) =>
            entry.scope === null ? { ...entry, scope: validatedScope } : entry,
          ),
        );
      });
    },
    list() {
      assertActive();
      return serialize(async () => {
        const stored = await readAndPrune();
        const entries = stored.filter(
          (entry): entry is FeedbackOutboxEntry =>
            entry.deliveryState !== 'DELIVERED_PENDING_CLEANUP',
        );
        if (entries.length !== stored.length) await saveEntries(entries);
        return entries.map((entry): FeedbackOutboxEntry => ({
          id: entry.id,
          scope: entry.scope,
          createdAt: entry.createdAt,
          deliveryState: entry.deliveryState,
          command: {
            ...entry.command,
            diagnosticSnapshot: {
              ...entry.command.diagnosticSnapshot,
              events: [...entry.command.diagnosticSnapshot.events],
            },
          },
        }));
      });
    },
    flush({ scope, bindUnscoped = true, deliver }) {
      assertActive();
      return (async () => {
        const validatedScope = FeedbackOutboxScopeSchema.parse(scope);
        const prepared = await serialize(async () => {
          let entries = await readAndPrune();
          if (bindUnscoped && entries.some((entry) => entry.scope === null)) {
            entries = entries.map((entry) =>
              entry.scope === null
                ? { ...entry, scope: validatedScope }
                : entry,
            );
            await saveEntries(entries);
          }

          const deliveredEntryIds = entries
            .filter(
              (entry) =>
                entry.scope === validatedScope &&
                entry.deliveryState === 'DELIVERED_PENDING_CLEANUP',
            )
            .map(({ id }) => id);
          if (deliveredEntryIds.length > 0) {
            const deliveredIds = new Set(deliveredEntryIds);
            entries = entries.filter((entry) => !deliveredIds.has(entry.id));
            await saveEntries(entries);
            for (const entryId of deliveredEntryIds) {
              queue.acknowledgedEntryIds.delete(entryId);
              queue.activeAttempts.delete(entryId);
            }
          }
          return {
            deliveredEntryIds,
            eligibleEntryIds: entries
              .filter(
                (entry) =>
                  entry.scope === validatedScope &&
                  entry.deliveryState !== 'DELIVERED_PENDING_CLEANUP',
              )
              .map(({ id }) => id),
          };
        });

        const deliveredEntryIds = [...prepared.deliveredEntryIds];
        for (const entryId of prepared.eligibleEntryIds) {
          const claim = await serialize(async () => {
            const entries = await readAndPrune();
            const entry = entries.find(({ id }) => id === entryId);
            if (
              !entry ||
              entry.scope !== validatedScope ||
              entry.deliveryState === 'DELIVERED_PENDING_CLEANUP'
            ) {
              return { status: 'STALE' as const };
            }
            if (queue.activeAttempts.has(entry.id)) {
              return { status: 'ACTIVE' as const };
            }
            const deliveryAttemptId = randomUUID();
            const attemptedEntry: StoredFeedbackOutboxEntry = {
              ...entry,
              deliveryState: 'DELIVERY_ATTEMPTED',
              deliveryAttemptId,
            };
            await saveEntries(
              entries.map((candidate) =>
                candidate.id === entry.id ? attemptedEntry : candidate,
              ),
            );
            queue.activeAttempts.set(entry.id, deliveryAttemptId);
            return {
              status: 'CLAIMED' as const,
              entry: attemptedEntry,
              deliveryAttemptId,
            };
          });
          if (claim.status === 'ACTIVE') continue;
          if (claim.status === 'STALE') continue;

          try {
            FeedbackSubmissionReceiptSchema.parse(
              await deliver(claim.entry.command),
            );
          } catch {
            await serialize(async () => {
              if (
                queue.activeAttempts.get(entryId) === claim.deliveryAttemptId
              ) {
                queue.activeAttempts.delete(entryId);
              }
            });
            scheduleQueueCleanup(coordinationIdentity, options.key, queue);
            return { deliveredEntryIds, stoppedOnError: true };
          }
          const finalized = await serialize(async () => {
            if (queue.activeAttempts.get(entryId) !== claim.deliveryAttemptId) {
              return false;
            }
            queue.activeAttempts.delete(entryId);
            let entries = await readAndPrune();
            const entry = entries.find(({ id }) => id === entryId);
            if (
              !entry ||
              entry.deliveryState !== 'DELIVERY_ATTEMPTED' ||
              entry.deliveryAttemptId !== claim.deliveryAttemptId ||
              entry.scope !== validatedScope
            ) {
              return false;
            }
            queue.acknowledgedEntryIds.add(entry.id);
            const tombstone: StoredFeedbackOutboxEntry = {
              id: entry.id,
              scope: entry.scope,
              createdAt: entry.createdAt,
              deliveryState: 'DELIVERED_PENDING_CLEANUP',
            };
            entries = entries.map((candidate) =>
              candidate.id === entry.id ? tombstone : candidate,
            );
            await saveEntries(entries);
            entries = entries.filter(({ id }) => id !== entry.id);
            await saveEntries(entries);
            queue.acknowledgedEntryIds.delete(entry.id);
            return true;
          });
          scheduleQueueCleanup(coordinationIdentity, options.key, queue);
          if (finalized) deliveredEntryIds.push(entryId);
        }
        return { deliveredEntryIds, stoppedOnError: false };
      })();
    },
    remove(entryId, allowedScope) {
      assertActive();
      return serialize(async () => {
        const validatedScope =
          allowedScope === undefined
            ? undefined
            : FeedbackOutboxScopeSchema.parse(allowedScope);
        const entries = await readAndPrune();
        const entry = entries.find(({ id }) => id === entryId);
        if (
          !entry ||
          (entry.scope !== null && entry.scope !== validatedScope)
        ) {
          return 'notFound';
        }
        const retained = entries.filter(({ id }) => id !== entryId);
        await saveEntries(retained);
        queue.activeAttempts.delete(entryId);
        if (
          entry.deliveryState === 'DELIVERED_PENDING_CLEANUP' ||
          queue.acknowledgedEntryIds.has(entryId)
        ) {
          queue.acknowledgedEntryIds.delete(entryId);
          return 'alreadyDelivered';
        }
        return entry.deliveryState === 'DELIVERY_ATTEMPTED'
          ? 'deliveryUnknown'
          : 'removedUnsent';
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseStorageQueue(coordinationIdentity, options.key, queue);
    },
  };
}
