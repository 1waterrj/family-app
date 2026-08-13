import { describe, expect, it, vi } from 'vitest';

import { createFamilyApiClient } from '../src/client.js';
import {
  createFeedbackOutbox,
  type StringStorage,
} from '../src/feedback-outbox.js';

const parentScope = '11111111-1111-4111-8111-111111111111';
const otherScope = '22222222-2222-4222-8222-222222222222';

function createStorage(): StringStorage {
  return createStorageBackend().adapter();
}

function createStorageBackend(): {
  adapter(): StringStorage;
  coordinationIdentity: object;
} {
  const values = new Map<string, string>();
  const coordinationIdentity = {};
  return {
    coordinationIdentity,
    adapter: () => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    }),
  };
}

function createCommand(
  idempotencyKey = '33333333-3333-4333-8333-333333333333',
) {
  return {
    idempotencyKey,
    category: 'BROKEN' as const,
    description: 'The app stopped refreshing.',
    diagnosticSnapshot: {
      source: 'PARENT_IOS' as const,
      appVersion: '0.1.0',
      currentScreen: 'PARENT_HOME' as const,
      events: [],
    },
  };
}

describe('feedback outbox', () => {
  it('persists setup drafts and atomically binds them to the first scope that flushes', async () => {
    const storage = createStorage();
    const outbox = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand());

    const reloaded = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const deliver = vi.fn().mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'NEW' as const,
      createdAt: '2026-08-10T12:00:00.000Z',
    });

    await reloaded.flush({ scope: parentScope, deliver });

    expect(deliver).toHaveBeenCalledWith(createCommand());
    expect(await reloaded.list()).toEqual([]);
  });

  it('never flushes a draft bound to another household scope', async () => {
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand(), parentScope);
    const deliver = vi.fn();

    expect(await outbox.flush({ scope: otherScope, deliver })).toEqual({
      deliveredEntryIds: [],
      stoppedOnError: false,
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(await outbox.list()).toHaveLength(1);
  });

  it('binds every unscoped draft before a failed drain can stop delivery', async () => {
    const storage = createStorage();
    const outbox = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand());
    await outbox.enqueue(createCommand('55555555-5555-4555-8555-555555555555'));

    expect(
      await outbox.flush({
        scope: parentScope,
        deliver: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).toEqual({ deliveredEntryIds: [], stoppedOnError: true });
    expect((await outbox.list()).map(({ scope }) => scope)).toEqual([
      parentScope,
      parentScope,
    ]);

    const otherScopeDelivery = vi.fn();
    await outbox.flush({ scope: otherScope, deliver: otherScopeDelivery });
    expect(otherScopeDelivery).not.toHaveBeenCalled();
  });

  it('binds unscoped drafts without attempting delivery', async () => {
    // Break caught: offline scope binding is implemented as a partial delivery flush that a stale session can resume.
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand());

    await outbox.bindUnscoped(parentScope);

    expect((await outbox.list()).map(({ scope }) => scope)).toEqual([
      parentScope,
    ]);
  });

  it('delivers only already-scoped drafts when unscoped binding is disabled', async () => {
    // Break caught: a stale delivery pass claims a newer setup draft for its old household.
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand(), parentScope);
    await outbox.enqueue(createCommand('55555555-5555-4555-8555-555555555555'));

    const result = await outbox.flush({
      scope: parentScope,
      bindUnscoped: false,
      deliver: vi.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        status: 'NEW' as const,
        createdAt: '2026-08-10T12:00:00.000Z',
      }),
    });

    expect(result.deliveredEntryIds).toHaveLength(1);
    expect((await outbox.list()).map(({ scope }) => scope)).toEqual([null]);
  });

  it('serializes overlapping writes from outboxes sharing a storage key', async () => {
    const storage = createStorage();
    const first = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const second = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:01.000Z'),
    });

    await Promise.all([
      first.enqueue(createCommand()),
      second.enqueue(createCommand('55555555-5555-4555-8555-555555555555')),
    ]);

    expect(
      (await first.list()).map(({ command }) => command.idempotencyKey).sort(),
    ).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555',
    ]);
  });

  it('uses the injected secure UUID source for durable entry IDs', async () => {
    // Break caught: tests and constrained browsers cannot supply UUIDs without mutating global crypto.
    const randomUUID = vi
      .fn()
      .mockReturnValue('66666666-6666-4666-8666-666666666666');
    const storage = createStorage();
    const outbox = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
      randomUUID,
    });

    await expect(outbox.enqueue(createCommand(), parentScope)).resolves.toBe(
      '66666666-6666-4666-8666-666666666666',
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('rejects empty scopes before reading or writing storage', async () => {
    const enqueueStorage = createStorage();
    const enqueueGet = vi.spyOn(enqueueStorage, 'getItem');
    const enqueueSet = vi.spyOn(enqueueStorage, 'setItem');
    const enqueueOutbox = createFeedbackOutbox({
      storage: enqueueStorage,
      key: 'feedback-outbox',
    });

    await expect(enqueueOutbox.enqueue(createCommand(), '')).rejects.toThrow();
    expect(enqueueGet).not.toHaveBeenCalled();
    expect(enqueueSet).not.toHaveBeenCalled();

    const flushStorage = createStorage();
    const flushGet = vi.spyOn(flushStorage, 'getItem');
    const flushOutbox = createFeedbackOutbox({
      storage: flushStorage,
      key: 'feedback-outbox',
    });
    await expect(
      flushOutbox.flush({ scope: '   ', deliver: vi.fn() }),
    ).rejects.toThrow();
    expect(flushGet).not.toHaveBeenCalled();
  });

  it('keeps a failed delivery and stops the drain', async () => {
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await outbox.enqueue(createCommand(), parentScope);

    const result = await outbox.flush({
      scope: parentScope,
      deliver: vi.fn().mockRejectedValue(new Error('offline')),
    });

    expect(result).toEqual({ deliveredEntryIds: [], stoppedOnError: true });
    expect(await outbox.list()).toHaveLength(1);
  });

  it('releases a timed-out first delivery so a later draft can progress', async () => {
    // Break caught: a never-settling first transport attempt permanently owns its claim and starves every later eligible draft.
    vi.useFakeTimers();
    try {
      const outbox = createFeedbackOutbox({
        storage: createStorage(),
        key: 'feedback-outbox',
      });
      await outbox.enqueue(createCommand(), parentScope);
      await outbox.enqueue(
        createCommand('55555555-5555-4555-8555-555555555555'),
        parentScope,
      );
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementationOnce(
          async () => new Promise<Response>(() => undefined),
        )
        .mockImplementation(async () => Response.json(deliveryReceipt()));
      const client = createFamilyApiClient({
        apiOrigin: 'https://api.fixture.test',
        accessToken: 'signed.fixture',
        fetch,
        requestTimeoutMs: 100,
      });

      const firstDrain = outbox.flush({
        scope: parentScope,
        deliver: client.createFeedback,
      });
      await vi.advanceTimersByTimeAsync(100);
      await expect(firstDrain).resolves.toEqual({
        deliveredEntryIds: [],
        stoppedOnError: true,
      });

      await expect(
        outbox.flush({ scope: parentScope, deliver: client.createFeedback }),
      ).resolves.toEqual({
        deliveredEntryIds: [expect.any(String), expect.any(String)],
        stoppedOnError: false,
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(await outbox.list()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never holds the storage lock while an old-scope delivery is unresolved', async () => {
    // Break caught: one hung family A request blocks family B enqueue, list, remove, and flush across outbox instances.
    const storage = createStorage();
    const ids = [
      '66666666-6666-4666-8666-666666666661',
      '66666666-6666-4666-8666-666666666662',
      '66666666-6666-4666-8666-666666666663',
      '66666666-6666-4666-8666-666666666664',
      '66666666-6666-4666-8666-666666666665',
    ];
    const randomUUID = () => ids.shift()!;
    const first = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      randomUUID,
    });
    const second = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      randomUUID,
    });
    await first.enqueue(createCommand(), parentScope);
    const oldScopeDelivery = vi.fn(() => new Promise<never>(() => undefined));
    void first.flush({ scope: parentScope, deliver: oldScopeDelivery });
    await untilCalled(oldScopeDelivery);

    const otherEntry = await completesSoon(
      second.enqueue(
        createCommand('55555555-5555-4555-8555-555555555555'),
        otherScope,
      ),
    );
    expect(await completesSoon(second.list())).toHaveLength(2);
    const removable = await completesSoon(
      second.enqueue(
        createCommand('88888888-8888-4888-8888-888888888888'),
        otherScope,
      ),
    );
    await expect(
      completesSoon(second.remove(removable, otherScope)),
    ).resolves.toBe('removedUnsent');
    const otherScopeDelivery = successfulDelivery();
    await expect(
      completesSoon(
        second.flush({ scope: otherScope, deliver: otherScopeDelivery }),
      ),
    ).resolves.toEqual({
      deliveredEntryIds: [otherEntry],
      stoppedOnError: false,
    });
    expect(otherScopeDelivery).toHaveBeenCalledTimes(1);
    expect(oldScopeDelivery).toHaveBeenCalledTimes(1);
    expect((await second.list()).map(({ scope }) => scope)).toEqual([
      parentScope,
    ]);
  });

  it('skips an active entry so a later command in the same scope can deliver', async () => {
    // Break caught: a hung first command makes ACTIVE terminate every later same-scope drain.
    const storage = createStorage();
    const first = createFeedbackOutbox({
      storage,
      key: 'same-scope-fairness-outbox',
    });
    const second = createFeedbackOutbox({
      storage,
      key: 'same-scope-fairness-outbox',
    });
    const firstEntry = await first.enqueue(createCommand(), parentScope);
    const hungDelivery = vi.fn(() => new Promise<never>(() => undefined));
    void first.flush({ scope: parentScope, deliver: hungDelivery });
    await untilCalled(hungDelivery);
    const secondEntry = await second.enqueue(
      createCommand('55555555-5555-4555-8555-555555555555'),
      parentScope,
    );
    const laterDelivery = successfulDelivery();

    await expect(
      completesSoon(
        second.flush({ scope: parentScope, deliver: laterDelivery }),
      ),
    ).resolves.toEqual({
      deliveredEntryIds: [secondEntry],
      stoppedOnError: false,
    });
    expect(hungDelivery).toHaveBeenCalledTimes(1);
    expect(laterDelivery).toHaveBeenCalledTimes(1);
    expect((await second.list()).map(({ id }) => id)).toEqual([firstEntry]);
  });

  it('coordinates distinct adapters backed by the same durable namespace and key', async () => {
    // Break caught: adapter object identity lets overlapping remounts deliver one durable entry twice.
    const backend = createStorageBackend();
    const first = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'distinct-adapter-outbox',
      coordinationIdentity: backend.coordinationIdentity,
    });
    const second = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'distinct-adapter-outbox',
      coordinationIdentity: backend.coordinationIdentity,
    });
    await first.enqueue(createCommand(), parentScope);
    const hungDelivery = vi.fn(() => new Promise<never>(() => undefined));
    void first.flush({ scope: parentScope, deliver: hungDelivery });
    await untilCalled(hungDelivery);
    const competingDelivery = successfulDelivery();

    await expect(
      completesSoon(
        second.flush({ scope: parentScope, deliver: competingDelivery }),
      ),
    ).resolves.toEqual({
      deliveredEntryIds: [],
      stoppedOnError: false,
    });
    expect(hungDelivery).toHaveBeenCalledTimes(1);
    expect(competingDelivery).not.toHaveBeenCalled();
  });

  it('does not couple unrelated durable backends that reuse a storage key', async () => {
    // Break caught: module coordination by key alone lets one backend outage stall another application's storage.
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = createFeedbackOutbox({
      storage: {
        getItem: async () => {
          await firstRead;
          return null;
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      key: 'shared-name',
      coordinationIdentity: {},
    });
    const second = createFeedbackOutbox({
      storage: createStorage(),
      key: 'shared-name',
      coordinationIdentity: {},
    });
    const blocked = first.list();

    await expect(completesSoon(second.list())).resolves.toEqual([]);

    releaseFirst();
    await blocked;
  });

  it('disposes an idle coordinator deterministically and rejects later use', async () => {
    // Break caught: every dynamically created outbox remains registered forever or mutates storage after its owner releases it.
    const backend = createStorageBackend();
    const first = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'dynamic-outbox',
      coordinationIdentity: backend.coordinationIdentity,
    });

    first.dispose();

    expect(() => first.list()).toThrow(/disposed/iu);
    const replacement = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'dynamic-outbox',
      coordinationIdentity: backend.coordinationIdentity,
    });
    await expect(replacement.list()).resolves.toEqual([]);
    replacement.dispose();
  });

  it('keeps independent storage keys operable while another key is in flight', async () => {
    // Break caught: broad live-instance coordination accidentally holds one global lock around a network request.
    const backend = createStorageBackend();
    const first = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'independent-key-a',
    });
    const second = createFeedbackOutbox({
      storage: backend.adapter(),
      key: 'independent-key-b',
    });
    await first.enqueue(createCommand(), parentScope);
    const hungDelivery = vi.fn(() => new Promise<never>(() => undefined));
    void first.flush({ scope: parentScope, deliver: hungDelivery });
    await untilCalled(hungDelivery);
    const secondEntry = await second.enqueue(
      createCommand('55555555-5555-4555-8555-555555555555'),
      parentScope,
    );

    await expect(
      completesSoon(
        second.flush({ scope: parentScope, deliver: successfulDelivery() }),
      ),
    ).resolves.toEqual({
      deliveredEntryIds: [secondEntry],
      stoppedOnError: false,
    });
  });

  it('clears an active generation after rejection so the same entry can retry', async () => {
    // Break caught: a rejected network attempt leaves an in-memory guard that permanently suppresses retries.
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'active-rejection-cleanup-outbox',
    });
    const entryId = await outbox.enqueue(createCommand(), parentScope);
    await expect(
      outbox.flush({
        scope: parentScope,
        deliver: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).resolves.toEqual({ deliveredEntryIds: [], stoppedOnError: true });

    await expect(
      outbox.flush({ scope: parentScope, deliver: successfulDelivery() }),
    ).resolves.toEqual({
      deliveredEntryIds: [entryId],
      stoppedOnError: false,
    });
  });

  it('allows only one in-flight delivery for an entry across outbox instances', async () => {
    // Break caught: releasing the lock around fetch lets a second instance send the same entry concurrently.
    const storage = createStorage();
    const first = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
    const second = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
    await first.enqueue(createCommand(), parentScope);
    const request = deferredDelivery();
    const firstFlush = first.flush({
      scope: parentScope,
      deliver: request.deliver,
    });
    await untilCalled(request.deliver);
    const competingDelivery = successfulDelivery();

    await expect(
      completesSoon(
        second.flush({ scope: parentScope, deliver: competingDelivery }),
      ),
    ).resolves.toEqual({
      deliveredEntryIds: [],
      stoppedOnError: false,
    });
    expect(competingDelivery).not.toHaveBeenCalled();

    request.resolve();
    await expect(firstFlush).resolves.toEqual({
      deliveredEntryIds: [expect.any(String)],
      stoppedOnError: false,
    });
    expect(await second.list()).toEqual([]);
  });

  it.each(['ACK', 'REJECT'] as const)(
    'does not resurrect a concurrently removed attempted entry after a late %s',
    async (outcome) => {
      // Break caught: a late transport result recreates private command data after deletion won the CAS race.
      const storage = createStorage();
      const first = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
      const second = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
      const entryId = await first.enqueue(createCommand(), parentScope);
      const request = deferredDelivery();
      const flush = first.flush({
        scope: parentScope,
        deliver: request.deliver,
      });
      await untilCalled(request.deliver);

      await expect(
        completesSoon(second.remove(entryId, parentScope)),
      ).resolves.toBe('deliveryUnknown');
      if (outcome === 'ACK') request.resolve();
      else request.reject(new Error('late offline'));

      await expect(flush).resolves.toEqual({
        deliveredEntryIds: [],
        stoppedOnError: outcome === 'REJECT',
      });
      expect(await second.list()).toEqual([]);
    },
  );

  it('does not let a late old-scope ACK consume a newly bound scope entry', async () => {
    // Break caught: a session switch lets family A's late completion delete or deliver family B's newer draft.
    const storage = createStorage();
    const first = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
    const second = createFeedbackOutbox({ storage, key: 'feedback-outbox' });
    await first.enqueue(createCommand(), parentScope);
    const request = deferredDelivery();
    const oldFlush = first.flush({
      scope: parentScope,
      deliver: request.deliver,
    });
    await untilCalled(request.deliver);
    await second.enqueue(createCommand('55555555-5555-4555-8555-555555555555'));
    await completesSoon(second.bindUnscoped(otherScope));
    const otherDelivery = successfulDelivery();
    await completesSoon(
      second.flush({ scope: otherScope, deliver: otherDelivery }),
    );

    request.resolve();
    await oldFlush;
    expect(otherDelivery).toHaveBeenCalledTimes(1);
    expect(request.deliver).toHaveBeenCalledTimes(1);
    expect(await second.list()).toEqual([]);
  });

  it('reports whether an individual entry was durably removed', async () => {
    // Break caught: the UI claims a queued draft was deleted after it was already delivered or never persisted.
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const entryId = await outbox.enqueue(createCommand(), parentScope);

    await expect(outbox.remove(entryId, parentScope)).resolves.toBe(
      'removedUnsent',
    );
    await expect(outbox.remove(entryId, parentScope)).resolves.toBe('notFound');
    expect(await outbox.list()).toEqual([]);
  });

  it('removes only entries allowed by the active or setup scope', async () => {
    // Break caught: a colliding foreign-scope entry ID can be deleted because authorization is checked before the serialized mutation or not at all.
    const outbox = createFeedbackOutbox({
      storage: createStorage(),
      key: 'scoped-remove-outbox',
    });
    const foreignEntry = await outbox.enqueue(createCommand(), otherScope);
    const setupEntry = await outbox.enqueue(
      createCommand('55555555-5555-4555-8555-555555555555'),
    );

    await expect(outbox.remove(foreignEntry, parentScope)).resolves.toBe(
      'notFound',
    );
    await expect(outbox.remove(setupEntry, parentScope)).resolves.toBe(
      'removedUnsent',
    );
    expect((await outbox.list()).map(({ id }) => id)).toEqual([foreignEntry]);
  });

  it('rechecks the allowed scope inside the serialized removal mutation', async () => {
    // Break caught: deletion authorizes an ID from an earlier list, then removes it after durable state has rebound that ID to another scope.
    const underlying = createStorage();
    let blockRead = false;
    let releaseRead!: () => void;
    let signalRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const storage: StringStorage = {
      ...underlying,
      getItem: async (key) => {
        if (blockRead) {
          signalRead();
          await readGate;
        }
        return underlying.getItem(key);
      },
    };
    const outbox = createFeedbackOutbox({
      storage,
      key: 'scope-race-outbox',
    });
    const entryId = await outbox.enqueue(createCommand(), parentScope);
    blockRead = true;

    const removal = outbox.remove(entryId, parentScope);
    await readStarted;
    const serialized = await underlying.getItem('scope-race-outbox');
    const entries = JSON.parse(serialized!) as Array<{ scope: string | null }>;
    entries[0]!.scope = otherScope;
    await underlying.setItem('scope-race-outbox', JSON.stringify(entries));
    releaseRead();

    await expect(removal).resolves.toBe('notFound');
    expect((await outbox.list())[0]?.scope).toBe(otherScope);
  });

  it('persists a private-content-free delivered tombstone before local cleanup', async () => {
    // Break caught: post-ACK cleanup failure leaves a full command that deletion later mislabels as unsent.
    const fault = createFaultStorage();
    const outbox = createFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const entryId = await outbox.enqueue(createCommand(), parentScope);
    fault.failNextRemoval();

    await expect(
      outbox.flush({ scope: parentScope, deliver: successfulDelivery() }),
    ).rejects.toThrow('storage removal failed');
    expect(fault.serialized('feedback-outbox')).toContain(
      'DELIVERED_PENDING_CLEANUP',
    );
    expect(fault.serialized('feedback-outbox')).not.toContain(
      'The app stopped refreshing.',
    );
    expect(fault.serialized('feedback-outbox')).not.toContain('command');

    const reloaded = createFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
    });
    await expect(reloaded.remove(entryId, parentScope)).resolves.toBe(
      'alreadyDelivered',
    );
    expect(fault.serialized('feedback-outbox')).toBeNull();
  });

  it('retries the same idempotent command after acknowledgement-state persistence fails', async () => {
    // Break caught: an ACK followed by a failed tombstone write is treated as a fresh unrelated submission or lost locally.
    const fault = createFaultStorage();
    const first = createFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    await first.enqueue(createCommand(), parentScope);
    fault.failNextDeliveredTombstoneWrite();
    const deliver = successfulDelivery();

    await expect(first.flush({ scope: parentScope, deliver })).rejects.toThrow(
      'tombstone write failed',
    );
    expect(fault.serialized('feedback-outbox')).toContain('DELIVERY_ATTEMPTED');

    const reloaded = createFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
    });
    await expect(
      reloaded.flush({ scope: parentScope, deliver }),
    ).resolves.toEqual({
      deliveredEntryIds: [expect.any(String)],
      stoppedOnError: false,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]?.[0].idempotencyKey).toBe(
      deliver.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(fault.serialized('feedback-outbox')).toBeNull();
  });

  it('reports delivery uncertainty instead of claiming an attempted draft was unsent', async () => {
    // Break caught: after a process reload loses an in-memory ACK, delete says an ACKed server report was only a local draft.
    const fault = createFaultStorage();
    const first = createFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const entryId = await first.enqueue(createCommand(), parentScope);
    fault.failNextDeliveredTombstoneWrite();
    await expect(
      first.flush({ scope: parentScope, deliver: successfulDelivery() }),
    ).rejects.toThrow('tombstone write failed');

    vi.resetModules();
    const { createFeedbackOutbox: createReloadedFeedbackOutbox } =
      await import('../src/feedback-outbox.js');
    const afterProcessReload = createReloadedFeedbackOutbox({
      storage: fault.adapter(),
      key: 'feedback-outbox',
    });
    await expect(afterProcessReload.remove(entryId, parentScope)).resolves.toBe(
      'deliveryUnknown',
    );
    expect(fault.serialized('feedback-outbox')).toBeNull();
  });

  it('expires dashboard drafts older than thirty days', async () => {
    let now = Date.parse('2026-08-10T12:00:00.000Z');
    const storage = createStorage();
    const outbox = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      expiresAfterMs: 30 * 24 * 60 * 60 * 1_000,
      now: () => now,
    });
    await outbox.enqueue(createCommand(), parentScope);
    now += 30 * 24 * 60 * 60 * 1_000 + 1;

    const reloaded = createFeedbackOutbox({
      storage,
      key: 'feedback-outbox',
      expiresAfterMs: 30 * 24 * 60 * 60 * 1_000,
      now: () => now,
    });
    expect(await reloaded.list()).toEqual([]);
  });
});

function successfulDelivery() {
  return vi.fn().mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    status: 'NEW' as const,
    createdAt: '2026-08-10T12:00:00.000Z',
  });
}

function deferredDelivery() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof deliveryReceipt>>(
    (resolvePromise, rejectPromise) => {
      resolve = () => resolvePromise(deliveryReceipt());
      reject = rejectPromise;
    },
  );
  return {
    deliver: vi.fn(() => promise),
    resolve,
    reject,
  };
}

function deliveryReceipt() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    status: 'NEW' as const,
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

async function untilCalled(mock: { mock: { calls: unknown[][] } }) {
  for (let count = 0; count < 20 && mock.mock.calls.length === 0; count += 1) {
    await Promise.resolve();
  }
  expect(mock.mock.calls).toHaveLength(1);
}

async function completesSoon<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('storage operation was blocked')), 100),
    ),
  ]);
}

function createFaultStorage(): {
  adapter(): StringStorage;
  failNextRemoval(): void;
  failNextDeliveredTombstoneWrite(): void;
  serialized(key: string): string | null;
} {
  const values = new Map<string, string>();
  let failRemoval = false;
  let failTombstoneWrite = false;
  return {
    adapter: () => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (failTombstoneWrite && value.includes('DELIVERED_PENDING_CLEANUP')) {
          failTombstoneWrite = false;
          throw new Error('tombstone write failed');
        }
        values.set(key, value);
      },
      removeItem: async (key) => {
        if (failRemoval) {
          failRemoval = false;
          throw new Error('storage removal failed');
        }
        values.delete(key);
      },
    }),
    failNextRemoval() {
      failRemoval = true;
    },
    failNextDeliveredTombstoneWrite() {
      failTombstoneWrite = true;
    },
    serialized: (key) => values.get(key) ?? null,
  };
}
