import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { createParentQueryClient } from '../src/query/create-query-client';
import { RewardsScreen } from '../src/screens/rewards-screen';
import {
  approvalSnapshot,
  jsonResponse,
  parentSession,
  primaryChildId,
} from './approval-fixtures';

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('parent rewards', () => {
  test('loads a child ledger only after selection and shows its aggregate and newest entries first', async () => {
    const requestedPaths: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      requestedPaths.push(path);
      return path === '/v1/parent/snapshot'
        ? jsonResponse(rewardsSnapshot())
        : jsonResponse(ledgerSummary());
    };
    renderRewards(fetchImpl);

    expect(await screen.findByText('Rewards')).toBeVisible();
    expect(requestedPaths).toEqual(['/v1/parent/snapshot']);
    expect(screen.queryByText('Birthday gift')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'View Avery rewards' }));

    expect(await screen.findByText('$12.50')).toBeVisible();
    const rows = screen.getAllByTestId('ledger-row');
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Birthday gift, manual credit, plus $5.00',
      'Book fair, purchase, minus $2.50',
    ]);
    expect(requestedPaths).toEqual([
      '/v1/parent/snapshot',
      `/v1/children/${primaryChildId}/ledger`,
    ]);
  });

  test.each([
    ['PURCHASE', 'Purchase', '2.75', -275],
    ['MANUAL_CREDIT', 'Manual credit', '3.25', 325],
    ['CORRECTION', 'Correction', '-1.50', -150],
    ['CORRECTION', 'Correction', '+1.50', 150],
  ] as const)(
    'records %s with the required sign and authenticated household',
    async (kind, kindLabel, amount, amountCents) => {
      const requests: RequestInit[] = [];
      const fetchImpl: typeof globalThis.fetch = async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === '/v1/parent/snapshot') {
          return jsonResponse(rewardsSnapshot());
        }
        if (init?.method !== 'POST') return jsonResponse(ledgerSummary());
        requests.push(init);
        return jsonResponse(transaction({ type: kind, amountCents }), 201);
      };
      renderRewards(fetchImpl);
      await screen.findByText('Rewards');
      fireEvent.press(
        screen.getByRole('button', { name: 'View Avery rewards' }),
      );
      await screen.findByText('$12.50');

      fireEvent.press(screen.getByRole('button', { name: kindLabel }));
      fireEvent.changeText(screen.getByLabelText('Ledger amount'), amount);
      fireEvent.changeText(
        screen.getByLabelText('Ledger note'),
        ' School supplies ',
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Save ledger entry' }),
      );

      expect(await screen.findByText('Ledger entry saved.')).toBeVisible();
      expect(JSON.parse(String(requests[0]?.body))).toEqual({
        householdId: parentSession.householdId,
        amountCents,
        type: kind,
        note: 'School supplies',
      });
      expect(headerValue(requests[0]?.headers, 'idempotency-key')).toMatch(
        uuidPattern,
      );
      expect(screen.getByLabelText('Ledger amount')).toHaveProp('value', '');
      expect(screen.getByLabelText('Ledger note')).toHaveProp('value', '');
    },
  );

  test.each([
    ['a missing note', 'PURCHASE', '2.00', '', 'Enter a note.'],
    [
      'fractional cents',
      'PURCHASE',
      '2.999',
      'Book',
      'Enter dollars with no more than two decimals.',
    ],
    [
      'an unsigned correction',
      'CORRECTION',
      '2.00',
      'Fix balance',
      'Corrections must start with + or -.',
    ],
  ] as const)(
    'rejects %s before contacting the ledger endpoint',
    async (_case, kind, amount, note, message) => {
      const fetchImpl = jest.fn(async (url: RequestInfo | URL) => {
        const path = new URL(String(url)).pathname;
        return path === '/v1/parent/snapshot'
          ? jsonResponse(rewardsSnapshot())
          : jsonResponse(ledgerSummary());
      });
      renderRewards(fetchImpl);
      await screen.findByText('Rewards');
      fireEvent.press(
        screen.getByRole('button', { name: 'View Avery rewards' }),
      );
      await screen.findByText('$12.50');
      fireEvent.press(
        screen.getByRole('button', {
          name: kind === 'CORRECTION' ? 'Correction' : 'Purchase',
        }),
      );
      fireEvent.changeText(screen.getByLabelText('Ledger amount'), amount);
      fireEvent.changeText(screen.getByLabelText('Ledger note'), note);
      fireEvent.press(
        screen.getByRole('button', { name: 'Save ledger entry' }),
      );

      expect(await screen.findByText(message)).toBeVisible();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  test('retains the form and operation key until the server confirms status 201', async () => {
    const operationKeys: string[] = [];
    let writes = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot') {
        return jsonResponse(rewardsSnapshot());
      }
      if (init?.method !== 'POST') return jsonResponse(ledgerSummary());
      writes += 1;
      operationKeys.push(headerValue(init.headers, 'idempotency-key'));
      return jsonResponse(transaction(), writes === 1 ? 200 : 201);
    };
    renderRewards(fetchImpl);
    await screen.findByText('Rewards');
    fireEvent.press(screen.getByRole('button', { name: 'View Avery rewards' }));
    await screen.findByText('$12.50');
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '2.00');
    fireEvent.changeText(screen.getByLabelText('Ledger note'), 'Book');
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(
      await screen.findByText('The server did not confirm the ledger entry.'),
    ).toBeVisible();
    expect(screen.getByDisplayValue('2.00')).toBeVisible();
    expect(screen.getByDisplayValue('Book')).toBeVisible();
    expect(screen.getByLabelText('Ledger amount')).toHaveProp(
      'editable',
      false,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));
    expect(await screen.findByText('Ledger entry saved.')).toBeVisible();
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[1]).toBe(operationKeys[0]);
  });

  test('requires an explicit new ledger operation before changing an ambiguous draft', async () => {
    const bodies: unknown[] = [];
    const operationKeys: string[] = [];
    let writes = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot') {
        return jsonResponse(rewardsSnapshot());
      }
      if (init?.method !== 'POST') return jsonResponse(ledgerSummary());
      writes += 1;
      bodies.push(JSON.parse(String(init.body)));
      operationKeys.push(headerValue(init.headers, 'idempotency-key'));
      if (writes === 1) throw new TypeError('offline');
      return jsonResponse(transaction({ amountCents: -350 }), 201);
    };
    renderRewards(fetchImpl);
    await screen.findByText('Rewards');
    fireEvent.press(screen.getByRole('button', { name: 'View Avery rewards' }));
    await screen.findByText('$12.50');
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '2.00');
    fireEvent.changeText(screen.getByLabelText('Ledger note'), 'Book');
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    fireEvent.press(
      screen.getByRole('button', { name: 'Start new ledger operation' }),
    );
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '3.50');
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(await screen.findByText('Ledger entry saved.')).toBeVisible();
    expect(bodies).toEqual([
      {
        householdId: parentSession.householdId,
        amountCents: -200,
        type: 'PURCHASE',
        note: 'Book',
      },
      {
        householdId: parentSession.householdId,
        amountCents: -350,
        type: 'PURCHASE',
        note: 'Book',
      },
    ]);
    expect(operationKeys[1]).not.toBe(operationKeys[0]);
  });

  test('allows correction after a confirmed validation error without rotating implicitly', async () => {
    const operationKeys: string[] = [];
    let writes = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot')
        return jsonResponse(rewardsSnapshot());
      if (init?.method !== 'POST') return jsonResponse(ledgerSummary());
      writes += 1;
      operationKeys.push(headerValue(init.headers, 'idempotency-key'));
      if (writes === 1) {
        return jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Amount is invalid.',
            requestId: '90000000-0000-4000-8000-000000000001',
          },
          400,
        );
      }
      return jsonResponse(transaction({ amountCents: -300 }), 201);
    };
    renderRewards(fetchImpl);
    await screen.findByText('Rewards');
    fireEvent.press(screen.getByRole('button', { name: 'View Avery rewards' }));
    await screen.findByText('$12.50');
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '2.00');
    fireEvent.changeText(screen.getByLabelText('Ledger note'), 'Book');
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(await screen.findByText('Amount is invalid.')).toBeVisible();
    expect(screen.getByLabelText('Ledger amount')).toHaveProp('editable', true);
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '3.00');
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(await screen.findByText('Ledger entry saved.')).toBeVisible();
    expect(operationKeys[1]).toBe(operationKeys[0]);
  });
});

function renderRewards(fetchImpl: typeof globalThis.fetch) {
  const queryClient = createParentQueryClient(parentSession);
  trackedQueryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <RewardsScreen session={parentSession} fetch={fetchImpl} />
    </QueryClientProvider>,
  );
}

function rewardsSnapshot() {
  return { ...approvalSnapshot(), pendingApprovals: [] };
}

function ledgerSummary() {
  return {
    householdId: parentSession.householdId,
    childId: primaryChildId,
    balanceCents: 1250,
    transactions: [
      transaction({
        id: '80000000-0000-4000-8000-000000000001',
        type: 'PURCHASE',
        amountCents: -250,
        note: 'Book fair',
        createdAt: '2026-08-09T12:00:00.000Z',
      }),
      transaction({
        id: '80000000-0000-4000-8000-000000000002',
        type: 'MANUAL_CREDIT',
        amountCents: 500,
        note: 'Birthday gift',
        createdAt: '2026-08-10T12:00:00.000Z',
      }),
    ],
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: '80000000-0000-4000-8000-000000000003',
    householdId: parentSession.householdId,
    childId: primaryChildId,
    amountCents: -200,
    type: 'PURCHASE' as const,
    note: 'Book',
    actorParentId: parentSession.actorId,
    relatedChoreInstanceId: null,
    approvalDecisionId: null,
    createdAt: '2026-08-10T13:00:00.000Z',
    ...overrides,
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? '';
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
