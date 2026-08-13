import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { App } from '../src/app';
import { DASHBOARD_SESSION_KEY } from '../src/auth/dashboard-session';
import type { AsyncKeyValueStore } from '../src/query/indexed-db-storage';
import { dashboardSession, dashboardSnapshot } from './test-fixtures';

function memoryStore(): AsyncKeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

const secondAvailableChore: (typeof dashboardSnapshot.chores)[number] = {
  ...dashboardSnapshot.chores[1]!,
  id: '40000000-0000-4000-8000-000000000003',
  choreTemplateId: '50000000-0000-4000-8000-000000000003',
  name: 'Set the table',
  imageKey: 'set-table',
  instructions: 'Put out plates, cups, and napkins.',
  createdAt: '2026-08-10T11:59:00.000Z',
};

describe('dashboard application dependencies', () => {
  test('keeps Tell us reachable while session loading and disconnected content cannot receive actions through the overlay', async () => {
    // Break caught: root feedback disappears outside the normal home route or the modal leaves underlying controls active.
    let resolveSession!: (session: undefined) => void;
    const sessionStore = {
      load: vi.fn(
        () =>
          new Promise<undefined>((resolve) => {
            resolveSession = resolve;
          }),
      ),
      save: vi.fn(),
      clear: vi.fn(),
    };
    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tell us' }));
    expect(screen.getByRole('dialog', { name: 'Tell us' })).toBeVisible();
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    resolveSession(undefined);
    expect(
      await screen.findByRole('heading', { name: 'Connect Family Kitchen' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tell us' })).toBeVisible();
  });

  test('keeps Tell us reachable when family data is disconnected', async () => {
    // Break caught: the feedback action is nested under a successful snapshot and disappears during server failure.
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={vi.fn().mockResolvedValue(
          Response.json(
            {
              code: 'INTERNAL_ERROR',
              message: 'Family server unavailable.',
              requestId: '60000000-0000-4000-8000-000000000001',
            },
            { status: 503 },
          ),
        )}
      />,
    );

    expect(
      await screen.findByText(
        'Family data could not be loaded. Try again in a moment.',
        {},
        { timeout: 6_000 },
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tell us' }));
    expect(screen.getByRole('dialog', { name: 'Tell us' })).toBeVisible();
  }, 8_000);

  test('loads a persisted browser session only once while the home shell renders', async () => {
    const browserStorage = createBrowserStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: browserStorage,
    });
    browserStorage.setItem(
      DASHBOARD_SESSION_KEY,
      JSON.stringify(dashboardSession),
    );
    const getItem = vi.spyOn(browserStorage, 'getItem');

    render(
      <App
        queryStorage={memoryStore()}
        fetch={async () =>
          new Response(JSON.stringify(dashboardSnapshot), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
      />,
    );

    expect(await screen.findByText('Avery')).toBeVisible();
    await waitFor(() => expect(getItem).toHaveBeenCalledTimes(1));

    getItem.mockRestore();
    browserStorage.clear();
  });

  test('connects the home, board, claim, and active chore screens to the family API', async () => {
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const requests: Request[] = [];
    let claimedChore: (typeof dashboardSnapshot.chores)[number] | undefined;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === 'GET') {
          const snapshot = claimedChore
            ? {
                ...dashboardSnapshot,
                chores: dashboardSnapshot.chores.map((chore) =>
                  chore.id === claimedChore?.id ? claimedChore : chore,
                ),
              }
            : dashboardSnapshot;
          return new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        claimedChore = {
          ...dashboardSnapshot.chores[1]!,
          status: 'CLAIMED',
          claimedChildId: dashboardSnapshot.children[0]!.profile.id,
          claimDeadlineAt: '2026-08-10T12:20:00.000Z',
        };
        return new Response(
          JSON.stringify({
            ...claimedChore,
            householdId: dashboardSession.householdId,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(
      await screen.findByRole('button', { name: "I'm done" }),
    ).toBeVisible();
    const claimRequest = requests.find(({ method }) => method === 'POST')!;
    expect(claimRequest.url).toContain(
      `/v1/chore-instances/${dashboardSnapshot.chores[1]!.id}/claim`,
    );
    expect(claimRequest.headers.get('idempotency-key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(await claimRequest.json()).toEqual({
      childId: dashboardSnapshot.children[0]!.profile.id,
    });
  });

  test('starts an active countdown only after a coherent full snapshot refresh', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-08-10T12:10:00.000Z'),
    );
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const claimedChore = {
      ...dashboardSnapshot.chores[1]!,
      status: 'CLAIMED' as const,
      claimedChildId: dashboardSnapshot.children[0]!.profile.id,
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
    };
    let getCount = 0;
    let resolveSnapshotRefresh!: (response: Response) => void;
    const snapshotRefresh = new Promise<Response>((resolve) => {
      resolveSnapshotRefresh = resolve;
    });
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') {
        return Response.json({
          ...claimedChore,
          householdId: dashboardSession.householdId,
        });
      }
      getCount += 1;
      if (getCount === 1) return Response.json(dashboardSnapshot);
      return snapshotRefresh;
    };

    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    await waitFor(() => expect(getCount).toBe(2));
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    resolveSnapshotRefresh(
      Response.json({
        ...dashboardSnapshot,
        serverTime: '2026-08-10T12:10:00.000Z',
        chores: dashboardSnapshot.chores.map((chore) =>
          chore.id === claimedChore.id ? claimedChore : chore,
        ),
      }),
    );

    expect(await screen.findByRole('timer')).toHaveTextContent('600 seconds');
  });

  test('keeps a cancelled successful claim on the board while its authoritative refresh settles', async () => {
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const claimedChore = {
      ...dashboardSnapshot.chores[1]!,
      status: 'CLAIMED' as const,
      claimedChildId: dashboardSnapshot.children[0]!.profile.id,
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
    };
    let getCount = 0;
    let postCount = 0;
    let resolveSnapshotRefresh!: (response: Response) => void;
    const snapshotRefresh = new Promise<Response>((resolve) => {
      resolveSnapshotRefresh = resolve;
    });
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') {
        postCount += 1;
        return Response.json({
          ...claimedChore,
          householdId: dashboardSession.householdId,
        });
      }
      getCount += 1;
      if (getCount === 1) return Response.json(dashboardSnapshot);
      return snapshotRefresh;
    };

    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    await waitFor(() => expect(getCount).toBe(2));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Choose who' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Chore Board' }));

    const pendingChore = screen.getByRole('button', {
      name: /open chore tidy toys/i,
    });
    expect(pendingChore).toBeDisabled();
    fireEvent.click(pendingChore);
    expect(postCount).toBe(1);

    resolveSnapshotRefresh(
      Response.json({
        ...dashboardSnapshot,
        chores: dashboardSnapshot.chores.map((chore) =>
          chore.id === claimedChore.id ? claimedChore : chore,
        ),
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Pick a chore' }),
    ).toBeVisible();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(postCount).toBe(1);
  });

  test('retains a successful claim operation when its authoritative refresh fails', async () => {
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const claimedChore = {
      ...dashboardSnapshot.chores[1]!,
      status: 'CLAIMED' as const,
      claimedChildId: dashboardSnapshot.children[0]!.profile.id,
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
    };
    let getCount = 0;
    const claimKeys: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') {
        claimKeys.push(request.headers.get('idempotency-key')!);
        return Response.json({
          ...claimedChore,
          householdId: dashboardSession.householdId,
        });
      }
      getCount += 1;
      if (getCount === 1) return Response.json(dashboardSnapshot);
      return Response.json(
        { code: 'INTERNAL_ERROR', message: 'snapshot unavailable' },
        { status: 503 },
      );
    };

    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(
      await screen.findByRole('alert', {}, { timeout: 6_000 }),
    ).toHaveTextContent('Could not reach the family server. Try again.');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(claimKeys).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(claimKeys).toHaveLength(2));
    expect(claimKeys[1]).toBe(claimKeys[0]);
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(claimKeys).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Choose who' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Chore Board' }));

    const guardedChore = screen.getByRole('button', {
      name: /open chore tidy toys/i,
    });
    expect(guardedChore).toBeDisabled();
    await waitFor(() => expect(getCount).toBe(7), { timeout: 6_000 });
    expect(guardedChore).toBeDisabled();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(claimKeys).toHaveLength(2);
  }, 15_000);

  test('retains every successful claim while multiple authoritative refreshes remain unresolved', async () => {
    const sessionStore = {
      load: vi.fn().mockResolvedValue(dashboardSession),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const twoChoreSnapshot = {
      ...dashboardSnapshot,
      chores: [dashboardSnapshot.chores[1]!, secondAvailableChore],
    };
    const claims: Array<{ choreId: string; idempotencyKey: string }> = [];
    let initialSnapshotSent = false;
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET' && !initialSnapshotSent) {
        initialSnapshotSent = true;
        return Response.json(twoChoreSnapshot);
      }
      if (request.method === 'GET') {
        return Response.json(
          { code: 'INTERNAL_ERROR', message: 'snapshot unavailable' },
          { status: 503 },
        );
      }
      const choreId = request.url.split('/').at(-2)!;
      claims.push({
        choreId,
        idempotencyKey: request.headers.get('idempotency-key')!,
      });
      const chore = twoChoreSnapshot.chores.find(({ id }) => id === choreId)!;
      return Response.json({
        ...chore,
        householdId: dashboardSession.householdId,
        status: 'CLAIMED',
        claimedChildId: dashboardSnapshot.children[0]!.profile.id,
        claimDeadlineAt: '2026-08-10T12:20:00.000Z',
      });
    };

    render(
      <App
        sessionStore={sessionStore}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    expect(
      await screen.findByRole('alert', {}, { timeout: 6_000 }),
    ).toHaveTextContent('Could not reach the family server. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chore Board' }));

    expect(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: /open chore set the table/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    expect(
      await screen.findByRole('alert', {}, { timeout: 6_000 }),
    ).toHaveTextContent('Could not reach the family server. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chore Board' }));

    const firstChore = screen.getByRole('button', {
      name: /open chore tidy toys/i,
    });
    const secondChore = screen.getByRole('button', {
      name: /open chore set the table/i,
    });
    expect(firstChore).toBeDisabled();
    expect(secondChore).toBeDisabled();
    fireEvent.click(firstChore);
    fireEvent.click(secondChore);
    expect(claims).toHaveLength(2);
    expect(claims.map(({ choreId }) => choreId)).toEqual([
      dashboardSnapshot.chores[1]!.id,
      secondAvailableChore.id,
    ]);
    expect(claims[0]!.idempotencyKey).not.toBe(claims[1]!.idempotencyKey);
  }, 20_000);

  test.each(['AVAILABLE', 'CLAIMED'] as const)(
    'reconciles a successful claim tombstone when a newer full snapshot reports %s',
    async (authoritativeStatus) => {
      const sessionStore = {
        load: vi.fn().mockResolvedValue(dashboardSession),
        save: vi.fn(),
        clear: vi.fn(),
      };
      const availableChore = dashboardSnapshot.chores[1]!;
      const initialSnapshot = {
        ...dashboardSnapshot,
        chores: [availableChore],
      };
      let responseMode: 'initial' | 'failure' | 'authoritative' = 'initial';
      let postCount = 0;
      const fetchImpl: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.method === 'POST') {
          postCount += 1;
          responseMode = 'failure';
          return Response.json({
            ...availableChore,
            householdId: dashboardSession.householdId,
            status: 'CLAIMED',
            claimedChildId: dashboardSnapshot.children[0]!.profile.id,
            claimDeadlineAt: '2026-08-10T12:20:00.000Z',
          });
        }
        if (responseMode === 'initial') return Response.json(initialSnapshot);
        if (responseMode === 'failure') {
          return Response.json(
            { code: 'INTERNAL_ERROR', message: 'snapshot unavailable' },
            { status: 503 },
          );
        }
        const authoritativeChore =
          authoritativeStatus === 'AVAILABLE'
            ? availableChore
            : {
                ...availableChore,
                status: 'CLAIMED' as const,
                claimedChildId: dashboardSnapshot.children[0]!.profile.id,
                claimDeadlineAt: '2026-08-10T12:20:00.000Z',
              };
        return Response.json({
          ...initialSnapshot,
          serverTime: '2026-08-10T12:10:00.000Z',
          chores: [authoritativeChore],
        });
      };

      render(
        <App
          sessionStore={sessionStore}
          queryStorage={memoryStore()}
          fetch={fetchImpl}
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Open Chore Board' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: /open chore tidy toys/i }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
      fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
      expect(
        await screen.findByRole('alert', {}, { timeout: 6_000 }),
      ).toHaveTextContent('Could not reach the family server. Try again.');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Chore Board' }));
      expect(
        screen.getByRole('button', { name: /open chore tidy toys/i }),
      ).toBeDisabled();

      responseMode = 'authoritative';
      document.dispatchEvent(new Event('visibilitychange'));

      if (authoritativeStatus === 'AVAILABLE') {
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: /open chore tidy toys/i }),
          ).toBeEnabled(),
        );
      } else {
        await waitFor(() =>
          expect(
            screen.queryByRole('button', { name: /open chore tidy toys/i }),
          ).not.toBeInTheDocument(),
        );
      }
      expect(postCount).toBe(1);
    },
    15_000,
  );
});

function createBrowserStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
