import { createFeedbackOutbox, type ClientSession } from '@family/api-client';
import type { CreateFeedbackCommand } from '@family/contracts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { StrictMode } from 'react';

import {
  App,
  DASHBOARD_FEEDBACK_OUTBOX_KEY,
  dashboardFeedbackScope,
} from '../src/app';
import type { DashboardSessionStore } from '../src/auth/dashboard-session';
import type { AsyncKeyValueStore } from '../src/query/indexed-db-storage';
import {
  credentialJson,
  dashboardSession,
  dashboardSnapshot,
} from './test-fixtures';

const receipt = {
  id: '70000000-0000-4000-8000-000000000001',
  status: 'NEW' as const,
  createdAt: '2026-08-10T12:00:00.000Z',
};

describe('dashboard feedback outbox runtime', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  test('keeps the outbox usable through the StrictMode effect replay', async () => {
    // Break caught: the first StrictMode cleanup permanently disposes the state-owned outbox before the real mount starts.
    const storage = memoryStore();
    const fetchImpl = successfulFetch();
    render(
      <StrictMode>
        <App
          sessionStore={fixedSessionStore(dashboardSession)}
          queryStorage={storage}
          fetch={fetchImpl}
        />
      </StrictMode>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    expect(
      screen.queryByText(
        'Saved feedback could not be checked. Try again later.',
      ),
    ).not.toBeInTheDocument();
  });

  test('queues before setup, then atomically binds and flushes after credential import', async () => {
    // Break caught: setup feedback is lost or requires a child/login identity before it can be delivered.
    const storage = memoryStore();
    let currentSession: ClientSession | undefined;
    const sessionStore: DashboardSessionStore = {
      load: vi.fn(async () => currentSession),
      save: vi.fn(async (session) => {
        currentSession = session;
      }),
      clear: vi.fn(),
    };
    const fetchImpl = successfulFetch();
    render(
      <App
        sessionStore={sessionStore}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.change(screen.getByLabelText('Tell us more (optional)'), {
      target: { value: 'Avery token=https://private.test/?secret=yes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(
      await screen.findByText(
        'Your feedback was saved. We will send it when the family server reconnects.',
      ),
    ).toBeVisible();

    const outbox = dashboardOutbox(storage);
    expect(await outbox.list()).toEqual([
      expect.objectContaining({ scope: null }),
    ]);
    expect(feedbackRequests(fetchImpl)).toHaveLength(0);
    fireEvent.change(
      await screen.findByLabelText('Dashboard credential JSON'),
      {
        target: { value: credentialJson('DASHBOARD') },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));

    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    const submitted = (await feedbackRequests(fetchImpl)[0]!.json()) as {
      description: string;
      diagnosticSnapshot: unknown;
    };
    expect(submitted.description).toBe(
      'Avery token=https://private.test/?secret=yes',
    );
    expect(submitted.diagnosticSnapshot).toEqual(
      expect.objectContaining({
        source: 'DASHBOARD',
        currentScreen: 'DASHBOARD_FEEDBACK',
      }),
    );
    expect(JSON.stringify(submitted.diagnosticSnapshot)).not.toContain('Avery');
    expect(JSON.stringify(submitted.diagnosticSnapshot)).not.toContain(
      'secret',
    );
    await waitFor(async () => expect(await outbox.list()).toEqual([]));
  });

  test('persists feedback when a plain-LAN browser exposes getRandomValues without randomUUID', async () => {
    // Break caught: Chromium on an untrusted HTTP LAN origin cannot submit because randomUUID is absent.
    const storage = memoryStore();
    const originalRandomUUID = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      'randomUUID',
    );
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });

    try {
      render(
        <App
          sessionStore={fixedSessionStore(undefined)}
          queryStorage={storage}
          fetch={successfulFetch()}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
      fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      await screen.findByText(
        'Your feedback was saved. We will send it when the family server reconnects.',
      );
      const entries = await dashboardOutbox(storage).list();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.command.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    } finally {
      if (originalRandomUUID) {
        Object.defineProperty(
          globalThis.crypto,
          'randomUUID',
          originalRandomUUID,
        );
      } else {
        Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
      }
    }
  });

  test('offline feedback survives remount and is removed only after an acknowledged retry', async () => {
    // Break caught: remounting drops an undelivered report or removes it on a failed attempt.
    const storage = memoryStore();
    const sessionStore = fixedSessionStore(dashboardSession);
    const offlineFetch = successfulFetch({
      feedback: async () => {
        throw new TypeError('offline');
      },
    });
    const first = render(
      <App
        sessionStore={sessionStore}
        queryStorage={storage}
        fetch={offlineFetch}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.change(screen.getByLabelText('Tell us more (optional)'), {
      target: { value: 'Keep this after restart.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText(
      'Your feedback was saved. We will send it when the family server reconnects.',
    );
    expect(await dashboardOutbox(storage).list()).toHaveLength(1);
    first.unmount();

    const onlineFetch = successfulFetch();
    render(
      <App
        sessionStore={sessionStore}
        queryStorage={storage}
        fetch={onlineFetch}
      />,
    );

    await waitFor(() => expect(feedbackRequests(onlineFetch)).toHaveLength(1));
    await waitFor(async () =>
      expect(await dashboardOutbox(storage).list()).toEqual([]),
    );
  });

  test('coordinates overlapping App instances across adapters for one dashboard backend', async () => {
    // Break caught: remount overlap gives adapter wrappers separate queues, sends one durable report twice, and can strand DELIVERY_ATTEMPTED.
    const backend = memoryStoreBackend();
    const seededOutbox = dashboardOutbox(backend.adapter());
    await seededOutbox.enqueue(
      feedbackCommand(),
      dashboardFeedbackScope(dashboardSession),
    );
    seededOutbox.dispose();
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const fetchImpl = successfulFetch({
      feedback: async () => {
        await deliveryGate;
        return Response.json(receipt);
      },
    });

    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={backend.adapter()}
        fetch={fetchImpl}
      />,
    );
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={backend.adapter()}
        fetch={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.filter(
          ([input, init]) => new Request(input, init).method === 'GET',
        ),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(feedbackRequests(fetchImpl).length).toBeGreaterThan(0),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    const deliveryAttempts = feedbackRequests(fetchImpl).length;

    releaseDelivery();
    await waitFor(() =>
      expect(backend.value(DASHBOARD_FEEDBACK_OUTBOX_KEY)).toBeNull(),
    );
    expect(deliveryAttempts).toBe(1);
  });

  test('does not couple Apps backed by explicitly distinct storage backends', async () => {
    // Break caught: one module-global dashboard coordinator lets a stalled injected backend serialize unrelated stores behind it.
    let releaseBlockedRead!: () => void;
    const blockedRead = new Promise<void>((resolve) => {
      releaseBlockedRead = resolve;
    });
    const readStarted = deferred<void>();
    const blockedStorage: AsyncKeyValueStore & {
      coordinationIdentity: object;
    } = {
      coordinationIdentity: {},
      getItem: async (key) => {
        if (key === DASHBOARD_FEEDBACK_OUTBOX_KEY) {
          readStarted.resolve();
          await blockedRead;
        }
        return null;
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={blockedStorage}
        fetch={successfulFetch()}
      />,
    );
    await readStarted.promise;

    const independentBackend = memoryStoreBackend();
    const seededOutbox = dashboardOutbox(independentBackend.adapter());
    await seededOutbox.enqueue(
      feedbackCommand(),
      dashboardFeedbackScope(dashboardSession),
    );
    seededOutbox.dispose();
    const independentFetch = successfulFetch();
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={independentBackend.adapter()}
        fetch={independentFetch}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    const independentDeliveries = feedbackRequests(independentFetch).length;
    releaseBlockedRead();

    expect(independentDeliveries).toBe(1);
  });

  test('coalesces online and visible-document retry triggers into one in-flight drain', async () => {
    // Break caught: simultaneous browser wake signals send the same idempotent command in a rapid loop.
    onlineManager.setOnline(false);
    const storage = memoryStore();
    let resolveFeedback!: (value: Response) => void;
    const deferredFeedback = new Promise<Response>((resolve) => {
      resolveFeedback = resolve;
    });
    const fetchImpl = successfulFetch({
      feedback: () => deferredFeedback,
    });
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText(
      'Your feedback was saved. We will send it when the family server reconnects.',
    );

    act(() => {
      onlineManager.setOnline(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    expect(feedbackRequests(fetchImpl)).toHaveLength(1);
    resolveFeedback(Response.json(receipt));
    await waitFor(async () =>
      expect(await dashboardOutbox(storage).list()).toEqual([]),
    );
  });

  test('keeps a 429 report queued with calm guidance and no rapid retry loop', async () => {
    // Break caught: admission control loses the report, claims delivery, or immediately resubmits it.
    const storage = memoryStore();
    const fetchImpl = successfulFetch({
      feedback: async () =>
        Response.json(
          {
            code: 'RATE_LIMITED',
            message: 'Please wait.',
            requestId: '80000000-0000-4000-8000-000000000001',
          },
          { status: 429 },
        ),
    });
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'This is confusing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(
      await screen.findByText(
        "Your feedback was saved. We'll try again later.",
      ),
    ).toBeVisible();
    expect(await dashboardOutbox(storage).list()).toHaveLength(1);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(feedbackRequests(fetchImpl)).toHaveLength(1);
  });

  test('retries a queued 5xx at 5s, 30s, and 2m, then stops', async () => {
    // Break caught: dashboard transport/server retries are absent, rapid, jittered, or unbounded.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const storage = memoryStore();
      const outbox = dashboardOutbox(storage);
      await outbox.enqueue(
        feedbackCommand(),
        dashboardFeedbackScope(dashboardSession),
      );
      const fetchImpl = successfulFetch({
        feedback: async () =>
          Response.json(
            {
              code: 'INTERNAL_ERROR',
              message: 'Try later.',
              requestId: '80000000-0000-4000-8000-000000000001',
            },
            { status: 500 },
          ),
      });
      render(
        <App
          sessionStore={fixedSessionStore(dashboardSession)}
          queryStorage={storage}
          fetch={fetchImpl}
        />,
      );
      await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));

      await act(async () => vi.advanceTimersByTimeAsync(4_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(1);
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(2);
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(3);
      await act(async () => vi.advanceTimersByTimeAsync(120_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(4);
      await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  test('cancels a pending retry on scope change and unmount', async () => {
    // Break caught: a family A timer sends after family B takes over the dashboard or after App is gone.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const storage = memoryStore();
      const outbox = dashboardOutbox(storage);
      await outbox.enqueue(
        feedbackCommand(),
        dashboardFeedbackScope(dashboardSession),
      );
      const familyB: ClientSession = {
        ...dashboardSession,
        accessToken: 'family-b-token',
        actorId: '10000000-0000-4000-8000-000000000009',
        householdId: '20000000-0000-4000-8000-000000000009',
      };
      const fetchImpl = successfulFetch({
        feedback: async () =>
          Response.json(
            {
              code: 'INTERNAL_ERROR',
              message: 'Try later.',
              requestId: '80000000-0000-4000-8000-000000000001',
            },
            { status: 503 },
          ),
      });
      const view = render(
        <App
          sessionStore={fixedSessionStore(dashboardSession)}
          queryStorage={storage}
          fetch={fetchImpl}
        />,
      );
      await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));

      view.rerender(
        <App
          sessionStore={fixedSessionStore(familyB)}
          queryStorage={storage}
          fetch={fetchImpl}
        />,
      );
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(1);
      view.unmount();
      await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
      expect(feedbackRequests(fetchImpl)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('aborts a hung production feedback request on dashboard scope change', async () => {
    // Break caught: replacing the dashboard credential leaves the old family's feedback POST alive after retry state resets.
    const storage = memoryStore();
    const familyB: ClientSession = {
      ...dashboardSession,
      accessToken: 'family-b-token',
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    };
    const feedbackSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === 'GET') return Response.json(dashboardSnapshot);
        feedbackSignals.push(request.signal);
        return new Promise<Response>(() => undefined);
      },
    );
    const view = render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(feedbackSignals).toHaveLength(1));

    view.rerender(
      <App
        sessionStore={fixedSessionStore(familyB)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );

    await waitFor(() => expect(feedbackSignals[0]?.aborted).toBe(true));
    expect(
      screen.queryByText(
        'Feedback is saved on this dashboard. Your family server did not respond.',
      ),
    ).not.toBeInTheDocument();
    view.unmount();
  });

  test('prunes feedback older than thirty days during an app-start outbox check', async () => {
    // Break caught: abandoned dashboard reports remain on shared kitchen storage indefinitely.
    const storage = memoryStore();
    const oldOutbox = createFeedbackOutbox({
      storage,
      key: DASHBOARD_FEEDBACK_OUTBOX_KEY,
      expiresAfterMs: 30 * 24 * 60 * 60 * 1_000,
      now: () => Date.parse('2026-06-01T12:00:00.000Z'),
    });
    await oldOutbox.enqueue(
      feedbackCommand(),
      dashboardFeedbackScope(dashboardSession),
    );
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-02T12:00:00.000Z'),
    );

    render(
      <App
        sessionStore={fixedSessionStore(undefined)}
        queryStorage={storage}
        fetch={successfulFetch()}
      />,
    );

    await waitFor(async () => expect(await oldOutbox.list()).toEqual([]));
  });

  test('binds an offline setup report to the first household and never flushes it in another scope', async () => {
    // Break caught: logout/session races let a later household claim a prior family's report.
    onlineManager.setOnline(false);
    const storage = memoryStore();
    const outbox = dashboardOutbox(storage);
    await outbox.enqueue(feedbackCommand());
    const familyAStore = fixedSessionStore(dashboardSession);
    const familyB: ClientSession = {
      ...dashboardSession,
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    };
    const fetchImpl = successfulFetch();
    const view = render(
      <App
        sessionStore={familyAStore}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(async () =>
      expect((await outbox.list())[0]?.scope).toBe(
        dashboardFeedbackScope(dashboardSession),
      ),
    );

    view.rerender(
      <App
        sessionStore={fixedSessionStore(familyB)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    act(() => onlineManager.setOnline(true));

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(feedbackRequests(fetchImpl)).toHaveLength(0);
    expect((await outbox.list())[0]?.scope).toBe(
      dashboardFeedbackScope(dashboardSession),
    );
  });

  test('direct family A to B store transition clears A diagnostics before B submits', async () => {
    // Break caught: a new dashboard household can attach the old household's request correlation history.
    const storage = memoryStore();
    const familyB: ClientSession = {
      ...dashboardSession,
      accessToken: 'family-b-token',
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    };
    const fetchImpl = scopedDiagnosticFetch(familyB);
    const view = render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([input, init]) =>
          new Request(input, init).headers
            .get('authorization')
            ?.includes(dashboardSession.accessToken),
        ),
      ).toBe(true),
    );

    view.rerender(
      <App
        sessionStore={fixedSessionStore(familyB)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    const submitted = await feedbackRequests(fetchImpl)[0]!.json();
    expect(JSON.stringify(submitted)).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  test('a deferred family A request cannot append diagnostics after family B takes over', async () => {
    // Break caught: a late family A query result repopulates the diagnostic buffer after the direct A-to-B reset.
    const storage = memoryStore();
    const familyB: ClientSession = {
      ...dashboardSession,
      accessToken: 'family-b-token',
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    };
    const familyARequest = deferred<Response>();
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === 'POST') return Response.json(receipt);
        if (
          request.headers.get('authorization') ===
          `Bearer ${dashboardSession.accessToken}`
        ) {
          return familyARequest.promise;
        }
        if (
          request.headers.get('authorization') ===
          `Bearer ${familyB.accessToken}`
        ) {
          return Response.json(dashboardSnapshot);
        }
        throw new Error('Unexpected unauthenticated request.');
      },
    );
    const view = render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    view.rerender(
      <App
        sessionStore={fixedSessionStore(familyB)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([input, init]) =>
          new Request(input, init).headers
            .get('authorization')
            ?.includes(familyB.accessToken),
        ),
      ).toBe(true),
    );
    await act(async () => {
      familyARequest.resolve(
        Response.json(
          {
            code: 'INTERNAL_ERROR',
            message: 'Family A failed.',
            requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          { status: 503 },
        ),
      );
      await familyARequest.promise;
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    const submitted = await feedbackRequests(fetchImpl)[0]!.json();
    expect(JSON.stringify(submitted)).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  test('family A to logout to B clears A diagnostics while retaining the setup draft', async () => {
    // Break caught: a device-local setup draft either leaks family A diagnostics or disappears before family B can send it.
    const storage = memoryStore();
    const familyB: ClientSession = {
      ...dashboardSession,
      accessToken: 'family-b-token',
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    };
    const fetchImpl = scopedDiagnosticFetch(familyB);
    const view = render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    view.rerender(
      <App
        sessionStore={fixedSessionStore(undefined)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.change(screen.getByLabelText('Tell us more (optional)'), {
      target: { value: 'Setup after logout' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText(
      'Your feedback was saved. We will send it when the family server reconnects.',
    );

    view.rerender(
      <App
        sessionStore={fixedSessionStore(familyB)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );
    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    const submitted = await feedbackRequests(fetchImpl)[0]!.json();
    expect(submitted).toEqual(
      expect.objectContaining({ description: 'Setup after logout' }),
    );
    expect(JSON.stringify(submitted)).not.toContain(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  test('traps initial reverse focus and Escape restores the exact inert route', async () => {
    // Break caught: initial Shift+Tab escapes the dialog, or feedback navigation replaces dashboard state.
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={memoryStore()}
        fetch={successfulFetch()}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    expect(screen.getByRole('heading', { name: 'Pick a chore' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tell us' }));

    const dialog = screen.getByRole('dialog', { name: 'Tell us' });
    const back = screen.getByRole('button', { name: 'Back' });
    const privacySummary = screen.getByText('What gets sent?');
    expect(dialog).toBeVisible();
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('inert');
    expect(
      screen.queryByRole('heading', { name: 'Pick a chore' }),
    ).not.toBeInTheDocument();
    expect(back).toHaveFocus();
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(privacySummary).toHaveFocus();
    fireEvent.keyDown(privacySummary, { key: 'Tab' });
    expect(back).toHaveFocus();
    fireEvent.keyDown(back, { key: 'Escape' });

    expect(screen.getByRole('heading', { name: 'Pick a chore' })).toBeVisible();
    expect(screen.getByTestId('dashboard-content')).not.toHaveAttribute(
      'inert',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tell us' })).toHaveFocus(),
    );
  });

  test('a deferred submission cannot close a replacement feedback overlay', async () => {
    // Break caught: an old submit continuation closes a newer overlay and schedules a false acknowledgement.
    let resolveFeedback!: (response: Response) => void;
    const deferredFeedback = new Promise<Response>((resolve) => {
      resolveFeedback = resolve;
    });
    const fetchImpl = successfulFetch({
      feedback: () => deferredFeedback,
    });
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Tell us' }), {
      key: 'Escape',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tell us' }));
    const replacementDialog = screen.getByRole('dialog', { name: 'Tell us' });
    timeoutSpy.mockClear();

    await act(async () => {
      resolveFeedback(Response.json(receipt));
      await deferredFeedback;
    });

    expect(replacementDialog).toBeVisible();
    expect(
      screen.queryByText('Thanks - your feedback was saved and sent.'),
    ).not.toBeInTheDocument();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('root unmount cancels every late feedback state and timer continuation', async () => {
    // Break caught: a settled submit writes state and starts acknowledgement timers after App unmounts.
    let resolveFeedback!: (response: Response) => void;
    const deferredFeedback = new Promise<Response>((resolve) => {
      resolveFeedback = resolve;
    });
    const fetchImpl = successfulFetch({
      feedback: () => deferredFeedback,
    });
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const view = render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tell us' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(feedbackRequests(fetchImpl)).toHaveLength(1));
    view.unmount();
    expect(feedbackRequests(fetchImpl)[0]?.signal.aborted).toBe(true);
    timeoutSpy.mockClear();

    await act(async () => {
      resolveFeedback(Response.json(receipt));
      await deferredFeedback;
    });

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

function memoryStore(): AsyncKeyValueStore {
  return memoryStoreBackend().adapter();
}

function memoryStoreBackend(): {
  coordinationIdentity: object;
  adapter(): AsyncKeyValueStore & { coordinationIdentity: object };
  value(key: string): string | null;
} {
  const values = new Map<string, string>();
  const coordinationIdentity = {};
  return {
    coordinationIdentity,
    adapter: () => ({
      coordinationIdentity,
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    }),
    value: (key) => values.get(key) ?? null,
  };
}

function fixedSessionStore(
  session: ClientSession | undefined,
): DashboardSessionStore {
  return {
    load: vi.fn().mockResolvedValue(session),
    save: vi.fn(),
    clear: vi.fn(),
  };
}

function successfulFetch({
  feedback = async () => Response.json(receipt),
}: {
  feedback?: () => Promise<Response>;
} = {}): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'GET') return Response.json(dashboardSnapshot);
    if (new URL(request.url).pathname === '/v1/feedback') return feedback();
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
}

function scopedDiagnosticFetch(
  familyB: ClientSession,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'POST') return Response.json(receipt);
    if (
      request.headers.get('authorization') ===
      `Bearer ${dashboardSession.accessToken}`
    ) {
      return Response.json(
        {
          code: 'INTERNAL_ERROR',
          message: 'Family A failed.',
          requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        { status: 503 },
      );
    }
    if (
      request.headers.get('authorization') === `Bearer ${familyB.accessToken}`
    ) {
      return Response.json(dashboardSnapshot);
    }
    throw new Error('Unexpected unauthenticated request.');
  });
}

function feedbackRequests(fetchImpl: ReturnType<typeof vi.fn>): Request[] {
  return fetchImpl.mock.calls
    .map(
      ([input, init]) =>
        new Request(input as RequestInfo | URL, init as RequestInit),
    )
    .filter(
      (request) =>
        request.method === 'POST' &&
        new URL(request.url).pathname === '/v1/feedback',
    );
}

function dashboardOutbox(storage: AsyncKeyValueStore) {
  return createFeedbackOutbox({
    storage,
    key: DASHBOARD_FEEDBACK_OUTBOX_KEY,
    expiresAfterMs: 30 * 24 * 60 * 60 * 1_000,
  });
}

function feedbackCommand(): CreateFeedbackCommand {
  return {
    idempotencyKey: '90000000-0000-4000-8000-000000000001',
    category: 'BROKEN',
    description: 'Setup report',
    diagnosticSnapshot: {
      source: 'DASHBOARD',
      appVersion: 'development',
      currentScreen: 'SETUP',
      events: [],
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
