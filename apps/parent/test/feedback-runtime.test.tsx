import {
  createFeedbackOutbox,
  FamilyApiError,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import type { CreateFeedbackCommand, FeedbackScreen } from '@family/contracts';
import { NavigationContext } from 'expo-router/build/react-navigation/core';
import { act, render, waitFor } from '@testing-library/react-native';

import {
  PARENT_FEEDBACK_OUTBOX_KEY,
  ParentFeedbackProvider,
  type ParentFeedbackRuntime,
  useFeedbackRuntime,
  useRecordFeedbackScreen,
} from '../src/features/feedback/feedback-runtime';
import { parentFeedbackScope } from '../src/features/feedback/feedback-queries';
import {
  createMemoryAsyncStorage,
  type AsyncStorageLike,
} from './test-adapters';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};
const otherParentSession: ClientSession = {
  ...parentSession,
  actorId: '10000000-0000-4000-8000-000000000002',
  householdId: '20000000-0000-4000-8000-000000000002',
};
const feedbackReceipt = {
  id: '30000000-0000-4000-8000-000000000001',
  status: 'NEW' as const,
  createdAt: '2026-08-10T12:00:00.000Z',
};

function RuntimeProbe({
  onRuntime,
}: {
  onRuntime(runtime: ParentFeedbackRuntime): void;
}) {
  onRuntime(useFeedbackRuntime());
  return null;
}

type FocusNavigation = {
  isFocused(): boolean;
  addListener(event: 'focus' | 'blur', listener: () => void): () => void;
};

function FocusedScreenProbe({
  screen,
  navigation,
}: {
  screen: FeedbackScreen;
  navigation: FocusNavigation;
}) {
  return (
    <NavigationContext.Provider value={navigation as never}>
      <ScreenRecorder screen={screen} />
    </NavigationContext.Provider>
  );
}

function ScreenRecorder({ screen }: { screen: FeedbackScreen }) {
  useRecordFeedbackScreen(screen);
  return null;
}

function createFocusNavigation(initiallyFocused: boolean): {
  navigation: FocusNavigation;
  setFocused(focused: boolean): void;
  listenerCount(): number;
} {
  let focused = initiallyFocused;
  const listeners = {
    focus: new Set<() => void>(),
    blur: new Set<() => void>(),
  };
  return {
    navigation: {
      isFocused: () => focused,
      addListener: (event, listener) => {
        listeners[event].add(listener);
        return () => listeners[event].delete(listener);
      },
    },
    setFocused(nextFocused) {
      if (focused === nextFocused) return;
      focused = nextFocused;
      for (const listener of listeners[focused ? 'focus' : 'blur']) listener();
    },
    listenerCount: () => listeners.focus.size + listeners.blur.size,
  };
}

function screenEvents(runtime: ParentFeedbackRuntime): FeedbackScreen[] {
  return runtime.diagnostics
    .snapshot()
    .events.flatMap((event) => (event.kind === 'SCREEN' ? [event.screen] : []));
}

describe('parent feedback runtime', () => {
  test('records persisted tab focus as Home, Chores, then Home without duplicate screen noise', () => {
    // Break caught: mount-only tab diagnostics leave a stale screen after returning to an already-mounted route.
    const storage = createMemoryAsyncStorage();
    const home = createFocusNavigation(true);
    const chores = createFocusNavigation(false);
    let runtime!: ParentFeedbackRuntime;
    const view = render(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback: jest.fn() }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <FocusedScreenProbe screen="PARENT_HOME" navigation={home.navigation} />
        <FocusedScreenProbe
          screen="PARENT_CHORES"
          navigation={chores.navigation}
        />
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    expect(screenEvents(runtime)).toEqual(['PARENT_HOME']);
    act(() => {
      home.setFocused(false);
      chores.setFocused(true);
    });
    expect(screenEvents(runtime)).toEqual(['PARENT_HOME', 'PARENT_CHORES']);
    act(() => {
      chores.setFocused(false);
      home.setFocused(true);
      home.setFocused(true);
    });
    expect(runtime.diagnostics.snapshot().currentScreen).toBe('PARENT_HOME');
    expect(screenEvents(runtime)).toEqual([
      'PARENT_HOME',
      'PARENT_CHORES',
      'PARENT_HOME',
    ]);

    view.unmount();
    expect(home.listenerCount()).toBe(0);
    expect(chores.listenerCount()).toBe(0);
    const eventsAtUnmount = screenEvents(runtime);
    home.setFocused(false);
    chores.setFocused(true);
    expect(screenEvents(runtime)).toEqual(eventsAtUnmount);
  });

  test.each(['SETUP', 'PARENT_APPROVALS'] as const)(
    'records focused %s routes once across ordinary rerenders',
    (feedbackScreen) => {
      // Break caught: stack/setup routes either fail to record or add duplicate diagnostics without a focus change.
      const storage = createMemoryAsyncStorage();
      const focus = createFocusNavigation(true);
      let runtime!: ParentFeedbackRuntime;
      const content = (
        <ParentFeedbackProvider
          session={feedbackScreen === 'SETUP' ? undefined : parentSession}
          fetch={unusedFetch}
          client={{ createFeedback: jest.fn() }}
          isOnline
          dependencies={feedbackDependencies(storage)}
        >
          <FocusedScreenProbe
            screen={feedbackScreen}
            navigation={focus.navigation}
          />
          <RuntimeProbe
            onRuntime={(value) => {
              runtime = value;
            }}
          />
        </ParentFeedbackProvider>
      );
      const view = render(content);

      expect(screenEvents(runtime)).toEqual([feedbackScreen]);
      view.rerender(content);
      expect(screenEvents(runtime)).toEqual([feedbackScreen]);
      act(() => focus.setFocused(false));
      expect(screenEvents(runtime)).toEqual([feedbackScreen]);
      act(() => focus.setFocused(true));
      expect(screenEvents(runtime)).toEqual([feedbackScreen, feedbackScreen]);
      view.unmount();
      expect(focus.listenerCount()).toBe(0);
    },
  );

  test('queues setup feedback, then binds and flushes it when the first parent session appears', async () => {
    // Break caught: setup feedback is discarded or cannot bind to the first authenticated parent.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: undefined,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });

    await act(async () => {
      await runtime.submit({
        category: 'BROKEN',
        description: 'Setup failed.',
      });
    });

    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    expect(await outbox.list()).toHaveLength(1);
    expect(createFeedback).not.toHaveBeenCalled();

    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await outbox.list()).toHaveLength(0));
  });

  test('flushes only unscoped or matching entries and leaves another session draft untouched', async () => {
    // Break caught: a parent can transmit feedback queued by a different authenticated actor.
    const storage = createMemoryAsyncStorage();
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    await outbox.enqueue(
      feedbackCommand('40000000-0000-4000-8000-000000000001'),
      parentFeedbackScope(otherParentSession),
    );
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);

    renderRuntime({ session: parentSession, storage, createFeedback });

    await waitFor(async () => expect(await outbox.list()).toHaveLength(1));
    expect(createFeedback).not.toHaveBeenCalled();
  });

  test('durably binds an unscoped draft to the first family while offline before any delivery attempt', async () => {
    // Break caught: an offline family A leaves a setup draft unscoped for family B to claim and send.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: undefined,
      storage,
      createFeedback,
      isOnline: false,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    await act(async () => {
      await runtime.submit({ category: 'BROKEN', description: 'Setup draft' });
    });
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    expect((await outbox.list())[0]?.scope).toBeNull();

    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline={false}
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    await waitFor(async () =>
      expect((await outbox.list())[0]?.scope).toBe(
        parentFeedbackScope(parentSession),
      ),
    );
    expect(createFeedback).not.toHaveBeenCalled();

    view.rerender(
      <ParentFeedbackProvider
        session={undefined}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline={false}
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    view.rerender(
      <ParentFeedbackProvider
        session={otherParentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createFeedback).not.toHaveBeenCalled();
    expect((await outbox.list())[0]?.scope).toBe(
      parentFeedbackScope(parentSession),
    );
  });

  test('one bind-and-delivery operation cannot claim a setup draft enqueued during binding', async () => {
    // Break caught: a second auto-binding delivery pass lets stale family A claim a newer setup draft.
    const underlying = createMemoryAsyncStorage();
    const familyScope = parentFeedbackScope(parentSession);
    let injectSetupDraft = false;
    let interleavedEnqueue: Promise<string> | undefined;
    const storage: AsyncStorageLike = {
      ...underlying,
      setItem: async (key, value) => {
        await underlying.setItem(key, value);
        if (key !== PARENT_FEEDBACK_OUTBOX_KEY) return;
        const entries = JSON.parse(value) as Array<{ scope: string | null }>;
        if (
          injectSetupDraft &&
          interleavedEnqueue === undefined &&
          entries.some(({ scope }) => scope === familyScope)
        ) {
          interleavedEnqueue = outbox.enqueue(
            feedbackCommand('40000000-0000-4000-8000-000000000002'),
          );
        }
      },
    };
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    await outbox.enqueue(
      feedbackCommand('40000000-0000-4000-8000-000000000001'),
    );
    injectSetupDraft = true;
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);

    renderRuntime({ session: parentSession, storage, createFeedback });

    await waitFor(() => expect(interleavedEnqueue).toBeDefined());
    await interleavedEnqueue;
    const queued = await outbox.list();
    expect(queued).toEqual([
      expect.objectContaining({
        scope: null,
        command: expect.objectContaining({
          idempotencyKey: '40000000-0000-4000-8000-000000000002',
        }),
      }),
    ]);
    expect(
      createFeedback.mock.calls.map(([command]) => command.idempotencyKey),
    ).toEqual(['40000000-0000-4000-8000-000000000001']);
  });

  test('a stale post-enqueue delivery cannot bind or send a newer setup draft', async () => {
    // Break caught: post-enqueue delivery lets stale family A auto-bind a newer setup draft after logout.
    const underlying = createMemoryAsyncStorage();
    const familyScope = parentFeedbackScope(parentSession);
    let injectSetupDraft = false;
    let interleavedEnqueue: Promise<string> | undefined;
    const storage: AsyncStorageLike = {
      ...underlying,
      setItem: async (key, value) => {
        await underlying.setItem(key, value);
        if (key !== PARENT_FEEDBACK_OUTBOX_KEY) return;
        const entries = JSON.parse(value) as Array<{ scope: string | null }>;
        if (
          injectSetupDraft &&
          interleavedEnqueue === undefined &&
          entries.some(({ scope }) => scope === familyScope)
        ) {
          interleavedEnqueue = outbox.enqueue(
            feedbackCommand('40000000-0000-4000-8000-000000000002'),
          );
        }
      },
    };
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;

    renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    injectSetupDraft = true;
    await act(async () => {
      await runtime.submit({
        category: 'BROKEN',
        description: 'Family A current-session draft',
      });
    });

    expect(interleavedEnqueue).toBeDefined();
    await interleavedEnqueue;
    const queued = await outbox.list();
    expect(queued).toEqual([
      expect.objectContaining({
        scope: null,
        command: expect.objectContaining({
          idempotencyKey: '40000000-0000-4000-8000-000000000002',
        }),
      }),
    ]);
    expect(
      createFeedback.mock.calls.map(([command]) => command.idempotencyKey),
    ).toEqual(['50000000-0000-4000-8000-000000000001']);
  });

  test.each([
    ['atomic bind-and-delivery read', 1],
    ['queued-entry list', 2],
    ['queued-count refresh', 3],
  ])(
    'keeps enqueue successful when the follow-up %s fails and retries the same command',
    async (_case, failureRead) => {
      // Break caught: a durable enqueue is reported as unsaved or retried under a new UUID.
      const storageFailure = createPostEnqueueReadFailure(failureRead);
      const createFeedback = jest.fn().mockRejectedValue(new Error('offline'));
      let runtime!: ParentFeedbackRuntime;
      renderRuntime({
        session: parentSession,
        storage: storageFailure.storage,
        createFeedback,
        onRuntime: (value) => {
          runtime = value;
        },
      });
      await act(async () => {
        await Promise.resolve();
      });

      let result: Awaited<ReturnType<ParentFeedbackRuntime['submit']>>;
      await act(async () => {
        result = await runtime.submit({
          category: 'IDEA',
          description: 'Durable once',
        });
      });

      expect(result!.status).toBe('saved');
      const underlyingOutbox = createFeedbackOutbox({
        storage: storageFailure.underlying,
        key: PARENT_FEEDBACK_OUTBOX_KEY,
      });
      const queued = await underlyingOutbox.list();
      expect(queued).toHaveLength(1);
      expect(queued[0]?.command.idempotencyKey).toBe(
        '50000000-0000-4000-8000-000000000001',
      );

      storageFailure.disable();
      createFeedback.mockResolvedValue(feedbackReceipt);
      await act(async () => {
        await runtime.retry();
      });

      expect(await underlyingOutbox.list()).toHaveLength(0);
      expect(
        new Set(
          createFeedback.mock.calls.map(([command]) => command.idempotencyKey),
        ),
      ).toEqual(new Set(['50000000-0000-4000-8000-000000000001']));
    },
  );

  test('records network diagnostics once per state change and never copies form text into events', async () => {
    // Break caught: rerenders duplicate network events or free-form feedback leaks into diagnostics.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockRejectedValue(new Error('offline'));
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      isOnline: false,
      onRuntime: (value) => {
        runtime = value;
      },
    });

    await waitFor(() =>
      expect(
        runtime.diagnostics
          .snapshot()
          .events.filter(({ kind }) => kind === 'NETWORK'),
      ).toHaveLength(1),
    );
    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline={false}
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    await act(async () => {
      await runtime.submit({
        category: 'CONFUSING',
        description: 'Avery calendar token=https://private.test/?secret=yes',
      });
    });

    const networkEvents = runtime.diagnostics
      .snapshot()
      .events.filter(({ kind }) => kind === 'NETWORK');
    expect(networkEvents).toEqual([
      expect.objectContaining({ kind: 'NETWORK', state: 'OFFLINE' }),
      expect.objectContaining({ kind: 'NETWORK', state: 'ONLINE' }),
    ]);
    expect(JSON.stringify(runtime.diagnostics.snapshot())).not.toContain(
      'Avery calendar token',
    );
    expect(createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Avery calendar token=https://private.test/?secret=yes',
      }),
    );
  });

  test('direct family A to B transition clears A diagnostics before B can snapshot them', () => {
    // Break caught: a direct authenticated scope swap includes family A request references and screens in family B feedback.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    runtime.diagnostics.recordScreen('PARENT_FEEDBACK_DETAIL');
    runtime.diagnostics.recordApiResult({
      operation: 'GET_FEEDBACK',
      outcome: 'ERROR',
      status: 503,
      errorCode: 'INTERNAL_ERROR',
      durationBucket: 'UNDER_1_SECOND',
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    view.rerender(
      <ParentFeedbackProvider
        session={otherParentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    expect(runtime.diagnostics.snapshot()).toEqual(
      expect.objectContaining({ currentScreen: 'SETUP' }),
    );
    expect(JSON.stringify(runtime.diagnostics.snapshot())).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(runtime.diagnostics.snapshot().events).toEqual([]);
  });

  test('a deferred family A request cannot append diagnostics after family B takes over', async () => {
    // Break caught: the scope reset clears existing A history but an already-running A request repopulates it later.
    const storage = createMemoryAsyncStorage();
    const request = deferred<Response>();
    const fetch = jest.fn(() => request.promise);
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    const view = render(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={fetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    const pending = runtime.fetch(
      'http://127.0.0.1:3000/v1/feedback/30000000-0000-4000-8000-000000000001',
    );

    view.rerender(
      <ParentFeedbackProvider
        session={otherParentSession}
        fetch={fetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    await act(async () => {
      request.resolve(
        Response.json(
          {
            code: 'INTERNAL_ERROR',
            message: 'Family A failed.',
            requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          { status: 503 },
        ),
      );
      await pending;
    });

    expect(runtime.diagnostics.snapshot().events).toEqual([]);
    expect(JSON.stringify(runtime.diagnostics.snapshot())).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  test('family A to logout to B clears A diagnostics but keeps useful setup-scope activity', () => {
    // Break caught: logout leaves family A history available to a later household, or erases new setup diagnostics.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    runtime.diagnostics.recordScreen('PARENT_REWARDS');
    runtime.diagnostics.recordApiResult({
      operation: 'GET_CHILD_BALANCE',
      outcome: 'ERROR',
      status: 503,
      errorCode: 'INTERNAL_ERROR',
      durationBucket: 'UNDER_1_SECOND',
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    view.rerender(
      <ParentFeedbackProvider
        session={undefined}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    runtime.diagnostics.recordScreen('SETUP');
    view.rerender(
      <ParentFeedbackProvider
        session={otherParentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    expect(JSON.stringify(runtime.diagnostics.snapshot())).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(screenEvents(runtime)).toEqual(['SETUP']);
  });

  test('exposes a diagnostic fetch that records only a templated operation result', async () => {
    // Break caught: useSession receives the raw fetch or diagnostics retain a URL/query/header value.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });

    await act(async () => {
      await runtime.fetch(
        'http://127.0.0.1:3000/v1/parent/snapshot?name=Avery&token=secret',
        { headers: { authorization: 'Bearer private-token' } },
      );
    });

    const serialized = JSON.stringify(runtime.diagnostics.snapshot());
    expect(runtime.diagnostics.snapshot().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'API_RESULT',
          operation: 'GET_PARENT_SNAPSHOT',
          outcome: 'SUCCESS',
          status: 204,
        }),
      ]),
    );
    expect(serialized).not.toContain('Avery');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('/v1/parent/snapshot');
  });

  test('catches app-start and manual retry storage failures as an actionable runtime status', async () => {
    // Break caught: background synchronization creates an unhandled rejection with no retry guidance.
    const underlying = createMemoryAsyncStorage();
    const storage: AsyncStorageLike = {
      ...underlying,
      getItem: async (key) => {
        if (key === PARENT_FEEDBACK_OUTBOX_KEY) {
          throw new Error('storage read failed');
        }
        return underlying.getItem(key);
      },
    };
    const createFeedback = jest.fn().mockResolvedValue(feedbackReceipt);
    let runtime!: ParentFeedbackRuntime;
    renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      onRuntime: (value) => {
        runtime = value;
      },
    });

    await waitFor(() =>
      expect(runtime.syncMessage).toBe(
        'Saved feedback could not be checked. Try again.',
      ),
    );
    await act(async () => {
      await expect(runtime.retry()).resolves.toBeUndefined();
    });
    expect(runtime.syncMessage).toBe(
      'Saved feedback could not be checked. Try again.',
    );
  });

  test('reports a transport retry status and clears it after manual delivery succeeds', async () => {
    // Break caught: Task 2 catches transport errors but the runtime presents no actionable retry state.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest.fn().mockRejectedValue(new Error('offline'));
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      isOnline: false,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    await act(async () => {
      await runtime.submit({ category: 'BROKEN', description: 'Retry me' });
    });

    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    await waitFor(() =>
      expect(runtime.syncMessage).toBe(
        'Feedback is saved on this phone. Your family server did not respond. Try sending again.',
      ),
    );
    createFeedback.mockResolvedValue(feedbackReceipt);
    await act(async () => {
      await runtime.retry();
    });
    expect(runtime.syncMessage).toBeUndefined();
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    expect(await outbox.list()).toHaveLength(0);
  });

  test('updates a visible queued entry when its delivery becomes uncertain', async () => {
    // Break caught: entry identity comparison hides the transition from unsent to delivery-attempted after a transport failure.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest
      .fn()
      .mockRejectedValue(new TypeError('connection closed after send'));
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      isOnline: false,
      onRuntime: (value) => {
        runtime = value;
      },
    });
    await act(async () => {
      await runtime.submit({ category: 'BROKEN', description: 'Attempt me.' });
    });
    expect(runtime.queuedEntries[0]?.deliveryState).toBe('QUEUED');

    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );
    await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(1));

    expect(runtime.queuedEntries[0]?.deliveryState).toBe('DELIVERY_ATTEMPTED');
  });

  test('returns the exact submitted snapshot without the later feedback POST event', async () => {
    // Break caught: the disclosure recomputes diagnostics after submit and claims the POST event was attached.
    const storage = createMemoryAsyncStorage();
    let runtime!: ParentFeedbackRuntime;
    let submittedBody: unknown;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body)) as unknown;
      return Response.json(feedbackReceipt);
    };
    render(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={fetch}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    let result: Awaited<ReturnType<ParentFeedbackRuntime['submit']>>;
    await act(async () => {
      result = await runtime.submit({
        category: 'CONFUSING',
        description: 'Snapshot once',
      });
    });

    expect(result!.diagnosticSnapshot).toEqual(
      expect.objectContaining({ source: 'PARENT_IOS' }),
    );
    expect(submittedBody).toEqual(
      expect.objectContaining({
        diagnosticSnapshot: result!.diagnosticSnapshot,
      }),
    );
    expect(result!.diagnosticSnapshot.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'CREATE_FEEDBACK' }),
      ]),
    );
    expect(runtime.diagnostics.snapshot().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'CREATE_FEEDBACK' }),
      ]),
    );
  });

  test('on reconnect removes acknowledged entries and retains the first failed entry for a later retry', async () => {
    // Break caught: an offline retry drops an unacknowledged report or resends an acknowledged one.
    const storage = createMemoryAsyncStorage();
    const createFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReceipt)
      .mockRejectedValueOnce(new Error('connection lost'));
    let runtime!: ParentFeedbackRuntime;
    const view = renderRuntime({
      session: parentSession,
      storage,
      createFeedback,
      isOnline: false,
      onRuntime: (value) => {
        runtime = value;
      },
    });

    await act(async () => {
      await runtime.submit({ category: 'BROKEN', description: 'First' });
      await runtime.submit({ category: 'IDEA', description: 'Second' });
    });
    const outbox = createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    });
    expect(await outbox.list()).toHaveLength(2);

    view.rerender(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={unusedFetch}
        client={{ createFeedback }}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe
          onRuntime={(value) => {
            runtime = value;
          }}
        />
      </ParentFeedbackProvider>,
    );

    await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(2));
    await waitFor(async () => {
      const queued = await outbox.list();
      expect(queued).toHaveLength(1);
      expect(queued[0]?.command.description).toBe('Second');
    });
  });

  test('retries retryable delivery at 5s, 30s, and 2m, then stops', async () => {
    // Break caught: queued transport/server failures never retry while online or spin without a bounded delay budget.
    jest.useFakeTimers();
    try {
      const storage = createMemoryAsyncStorage();
      const createFeedback = jest
        .fn()
        .mockRejectedValue(new FamilyApiError('UNAVAILABLE', 'Try later.'));
      let runtime!: ParentFeedbackRuntime;
      renderRuntime({
        session: parentSession,
        storage,
        createFeedback,
        onRuntime: (value) => {
          runtime = value;
        },
      });
      await act(async () => {
        await runtime.submit({ category: 'BROKEN', description: 'Retry' });
      });
      expect(createFeedback).toHaveBeenCalledTimes(1);

      await act(async () => jest.advanceTimersByTimeAsync(4_999));
      expect(createFeedback).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTimeAsync(1));
      expect(createFeedback).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTimeAsync(30_000));
      expect(createFeedback).toHaveBeenCalledTimes(3);
      await act(async () => jest.advanceTimersByTimeAsync(120_000));
      expect(createFeedback).toHaveBeenCalledTimes(4);
      await act(async () => jest.advanceTimersByTimeAsync(10 * 60_000));
      expect(createFeedback).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  test('cancels an old-scope retry on logout, direct scope change, and unmount', async () => {
    // Break caught: a scheduled family A delivery runs after logout, under family B, or after its provider is gone.
    jest.useFakeTimers();
    try {
      const storage = createMemoryAsyncStorage();
      const familyACreate = jest
        .fn()
        .mockRejectedValue(new FamilyApiError('UNAVAILABLE', 'Try later.'));
      const familyBCreate = jest.fn().mockResolvedValue(feedbackReceipt);
      let runtime!: ParentFeedbackRuntime;
      const view = renderRuntime({
        session: parentSession,
        storage,
        createFeedback: familyACreate,
        onRuntime: (value) => {
          runtime = value;
        },
      });
      await act(async () => {
        await runtime.submit({ category: 'BROKEN', description: 'Family A' });
      });
      expect(familyACreate).toHaveBeenCalledTimes(1);

      view.rerender(
        <ParentFeedbackProvider
          session={undefined}
          fetch={unusedFetch}
          client={{ createFeedback: familyACreate }}
          isOnline
          dependencies={feedbackDependencies(storage)}
        >
          <RuntimeProbe onRuntime={(value) => (runtime = value)} />
        </ParentFeedbackProvider>,
      );
      view.rerender(
        <ParentFeedbackProvider
          session={otherParentSession}
          fetch={unusedFetch}
          client={{ createFeedback: familyBCreate }}
          isOnline
          dependencies={feedbackDependencies(storage)}
        >
          <RuntimeProbe onRuntime={(value) => (runtime = value)} />
        </ParentFeedbackProvider>,
      );
      await act(async () => jest.advanceTimersByTimeAsync(5_000));
      expect(familyACreate).toHaveBeenCalledTimes(1);
      expect(familyBCreate).not.toHaveBeenCalled();

      view.unmount();
      await act(async () => jest.advanceTimersByTimeAsync(10 * 60_000));
      expect(familyACreate).toHaveBeenCalledTimes(1);
      expect(familyBCreate).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('cancels a hung production delivery on scope change without surfacing a stale error', async () => {
    // Break caught: changing family scope resets retry state but leaves the real API request alive forever.
    const storage = createMemoryAsyncStorage();
    const signals: AbortSignal[] = [];
    const requestStarted = deferred<void>();
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      signals.push(init?.signal as AbortSignal);
      requestStarted.resolve(undefined);
      return new Promise<Response>(() => undefined);
    };
    let runtime!: ParentFeedbackRuntime;
    const view = render(
      <ParentFeedbackProvider
        session={parentSession}
        fetch={fetch}
        isOnline
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe onRuntime={(value) => (runtime = value)} />
      </ParentFeedbackProvider>,
    );
    let submission!: Promise<
      Awaited<ReturnType<ParentFeedbackRuntime['submit']>>
    >;
    await act(async () => {
      submission = runtime.submit({
        category: 'BROKEN',
        description: 'Hung family A',
      });
      await requestStarted.promise;
    });
    expect(signals).toHaveLength(1);

    view.rerender(
      <ParentFeedbackProvider
        session={otherParentSession}
        fetch={fetch}
        isOnline={false}
        dependencies={feedbackDependencies(storage)}
      >
        <RuntimeProbe onRuntime={(value) => (runtime = value)} />
      </ParentFeedbackProvider>,
    );

    let result!: Awaited<ReturnType<ParentFeedbackRuntime['submit']>>;
    await act(async () => {
      result = await submission;
    });
    expect(result).toMatchObject({ status: 'saved' });
    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.syncMessage).toBeUndefined();
    view.unmount();
  });

  test('a timed-out first production delivery does not starve a follow-up draft', async () => {
    // Break caught: the runtime's coalesced drain never reaches a draft queued behind a fetch that ignores cancellation.
    jest.useFakeTimers();
    try {
      const storage = createMemoryAsyncStorage();
      const fetch = jest
        .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
        .mockImplementationOnce(
          async () => new Promise<Response>(() => undefined),
        )
        .mockImplementation(async () => Response.json(feedbackReceipt));
      const ids = [
        '50000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000002',
      ];
      let runtime!: ParentFeedbackRuntime;
      render(
        <ParentFeedbackProvider
          session={parentSession}
          fetch={fetch}
          isOnline
          dependencies={{
            ...feedbackDependencies(storage),
            randomUUID: () => ids.shift()!,
          }}
        >
          <RuntimeProbe onRuntime={(value) => (runtime = value)} />
        </ParentFeedbackProvider>,
      );

      let first!: Promise<Awaited<ReturnType<ParentFeedbackRuntime['submit']>>>;
      act(() => {
        first = runtime.submit({ category: 'BROKEN', description: 'First' });
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      let second!: Promise<
        Awaited<ReturnType<ParentFeedbackRuntime['submit']>>
      >;
      act(() => {
        second = runtime.submit({ category: 'IDEA', description: 'Second' });
      });

      await act(async () => jest.advanceTimersByTimeAsync(15_000));
      await act(async () => {
        await Promise.all([first, second]);
      });
      await act(async () => jest.advanceTimersByTimeAsync(5_000));

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
      const outbox = createFeedbackOutbox({
        storage,
        key: PARENT_FEEDBACK_OUTBOX_KEY,
      });
      await waitFor(async () => expect(await outbox.list()).toEqual([]));
    } finally {
      jest.useRealTimers();
    }
  });

  test('keeps a 429 queued with calm automatic-retry guidance', async () => {
    // Break caught: rate limiting is presented as a broken connection or triggers an immediate loop.
    jest.useFakeTimers();
    try {
      const storage = createMemoryAsyncStorage();
      const createFeedback = jest
        .fn()
        .mockRejectedValue(new FamilyApiError('RATE_LIMITED', 'Wait.'));
      let runtime!: ParentFeedbackRuntime;
      renderRuntime({
        session: parentSession,
        storage,
        createFeedback,
        onRuntime: (value) => {
          runtime = value;
        },
      });
      await act(async () => {
        await runtime.submit({ category: 'IDEA', description: '' });
      });

      expect(runtime.syncMessage).toBe(
        "Your feedback was saved. We'll try again later.",
      );
      expect(createFeedback).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTimeAsync(4_999));
      expect(createFeedback).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

function renderRuntime({
  session,
  storage,
  createFeedback,
  isOnline = true,
  onRuntime = () => undefined,
}: {
  session: ClientSession | undefined;
  storage: AsyncStorageLike;
  createFeedback: jest.MockedFunction<FamilyApiClient['createFeedback']>;
  isOnline?: boolean;
  onRuntime?: (runtime: ParentFeedbackRuntime) => void;
}) {
  return render(
    <ParentFeedbackProvider
      session={session}
      fetch={unusedFetch}
      client={{ createFeedback }}
      isOnline={isOnline}
      dependencies={feedbackDependencies(storage)}
    >
      <RuntimeProbe onRuntime={onRuntime} />
    </ParentFeedbackProvider>,
  );
}

function feedbackDependencies(storage: AsyncStorageLike) {
  return {
    now: () => new Date('2026-08-10T12:00:00.000Z'),
    randomUUID: () => '50000000-0000-4000-8000-000000000001',
    source: 'PARENT_IOS' as const,
    appVersion: '1.2.3',
    storage,
  };
}

function feedbackCommand(idempotencyKey: string): CreateFeedbackCommand {
  return {
    idempotencyKey,
    category: 'BROKEN',
    description: 'Different parent draft',
    diagnosticSnapshot: {
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      currentScreen: 'PARENT_HOME',
      events: [],
    },
  };
}

const unusedFetch: typeof globalThis.fetch = async () =>
  new Response(null, { status: 204 });

function createPostEnqueueReadFailure(failureRead: number): {
  storage: AsyncStorageLike;
  underlying: AsyncStorageLike;
  disable(): void;
} {
  const underlying = createMemoryAsyncStorage();
  let readsAfterEnqueue = 0;
  let enqueuePersisted = false;
  let enabled = true;
  const storage: AsyncStorageLike = {
    ...underlying,
    getItem: async (key) => {
      if (enabled && enqueuePersisted && key === PARENT_FEEDBACK_OUTBOX_KEY) {
        readsAfterEnqueue += 1;
        if (readsAfterEnqueue === failureRead) {
          throw new Error(`follow-up read ${failureRead} failed`);
        }
      }
      return underlying.getItem(key);
    },
    setItem: async (key, value) => {
      await underlying.setItem(key, value);
      if (key === PARENT_FEEDBACK_OUTBOX_KEY) enqueuePersisted = true;
    },
  };
  return {
    storage,
    underlying,
    disable() {
      enabled = false;
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}
