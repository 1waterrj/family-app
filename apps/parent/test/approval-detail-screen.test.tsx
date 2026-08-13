import { familyQueryKeys } from '@family/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { createParentQueryClient } from '../src/query/create-query-client';
import {
  ApprovalDetailScreen,
  settleApprovalDecision,
} from '../src/screens/approval-detail-screen';
import {
  approvalSnapshot,
  decisionResult,
  jsonResponse,
  oldAttemptId,
  parentSession,
  primaryChildId,
} from './approval-fixtures';

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('approval detail', () => {
  test('approves an adjusted exact-cent payout and invalidates the snapshot and child ledger', async () => {
    const requests: RequestInit[] = [];
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/v1/parent/snapshot')) {
        return jsonResponse(approvalSnapshot());
      }
      requests.push(init ?? {});
      return jsonResponse(decisionResult('APPROVED', { payoutCents: 275 }));
    };
    const { queryClient } = renderDetail(fetchImpl);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    fireEvent.changeText(screen.getByLabelText('Reward amount'), '2.75');
    fireEvent.changeText(screen.getByLabelText('Approval note'), 'Great focus');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Approved $2.75')).toBeVisible();
    const request = requests[0]!;
    expect(JSON.parse(String(request.body))).toEqual({
      submissionAttemptId: oldAttemptId,
      payoutCents: 275,
      note: 'Great focus',
    });
    expect(headerValue(request.headers, 'idempotency-key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.parentSnapshot(parentSession),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.ledger(parentSession, primaryChildId),
    });
  });

  test('keeps the populated form and reuses its operation UUID after a network failure', async () => {
    const operationKeys: string[] = [];
    let attempt = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/v1/parent/snapshot')) {
        return jsonResponse(approvalSnapshot());
      }
      operationKeys.push(headerValue(init?.headers, 'idempotency-key'));
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return jsonResponse(decisionResult('APPROVED', { payoutCents: 325 }));
    };
    renderDetail(fetchImpl);

    fireEvent.changeText(screen.getByLabelText('Reward amount'), '3.25');
    fireEvent.changeText(screen.getByLabelText('Approval note'), 'Kept trying');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(screen.getByDisplayValue('3.25')).toBeVisible();
    expect(screen.getByDisplayValue('Kept trying')).toBeVisible();
    expect(screen.getByLabelText('Reward amount')).toHaveProp(
      'editable',
      false,
    );
    expect(
      screen.getByRole('button', { name: 'Try this chore again' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Close this chore' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve chore' })).toBeEnabled();

    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));
    expect(await screen.findByText('Approved $3.25')).toBeVisible();
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[1]).toBe(operationKeys[0]);
  });

  test.each([
    ['Try this chore again', true],
    ['Close this chore', false],
  ] as const)(
    'sends %s as an explicit rejection decision',
    async (label, retry) => {
      let sentBody: unknown;
      const fetchImpl: typeof globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/v1/parent/snapshot')) {
          return jsonResponse(approvalSnapshot());
        }
        sentBody = JSON.parse(String(init?.body));
        const result = decisionResult('REJECTED');
        return jsonResponse({
          ...result,
          choreInstance: {
            ...result.choreInstance,
            status: retry ? 'CLAIMED' : 'CLOSED',
          },
        });
      };
      renderDetail(fetchImpl);

      fireEvent.changeText(
        screen.getByLabelText('Rejection reason'),
        'Please finish every step',
      );
      fireEvent.press(screen.getByRole('button', { name: label }));

      expect(await screen.findByText('Chore rejected')).toBeVisible();
      expect(sentBody).toEqual({
        submissionAttemptId: oldAttemptId,
        retry,
        reason: 'Please finish every step',
      });
    },
  );

  test('renders the immutable concurrent winning decision instead of the requested label', async () => {
    const fetchImpl: typeof globalThis.fetch = async (url) =>
      String(url).endsWith('/v1/parent/snapshot')
        ? jsonResponse(approvalSnapshot())
        : jsonResponse(
            decisionResult('REJECTED', {
              note: 'Already closed by another parent',
            }),
          );
    renderDetail(fetchImpl);

    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Chore rejected')).toBeVisible();
    expect(screen.getByText('Already closed by another parent')).toBeVisible();
    expect(screen.queryByText(/^Approved /)).toBeNull();
  });

  test('lets the parent correct fractional cents and then approve the same draft', async () => {
    const sentBodies: unknown[] = [];
    const fetchImpl = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) =>
        String(url).endsWith('/v1/parent/snapshot')
          ? jsonResponse(approvalSnapshot())
          : (() => {
              const body = JSON.parse(String(init?.body));
              sentBodies.push(body);
              return jsonResponse(
                decisionResult('APPROVED', { payoutCents: body.payoutCents }),
              );
            })(),
    );
    renderDetail(fetchImpl);

    fireEvent.changeText(screen.getByLabelText('Reward amount'), '2.999');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(
      await screen.findByText('Enter dollars with no more than two decimals.'),
    ).toBeVisible();
    await waitFor(() => expect(fetchImpl).not.toHaveBeenCalled());

    expect(screen.getByLabelText('Reward amount')).toHaveProp('editable', true);
    fireEvent.changeText(screen.getByLabelText('Reward amount'), '3.01');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Approved $3.01')).toBeVisible();
    expect(sentBodies).toEqual([
      {
        submissionAttemptId: oldAttemptId,
        payoutCents: 301,
      },
    ]);
  });

  test('unlocks a payout rejected by server validation so the parent can correct it', async () => {
    const sentBodies: unknown[] = [];
    let decisionAttempt = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/v1/parent/snapshot')) {
        return jsonResponse(approvalSnapshot());
      }
      const body = JSON.parse(String(init?.body));
      sentBodies.push(body);
      decisionAttempt += 1;
      if (decisionAttempt === 1) {
        return jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Reward cannot exceed $10.00.',
            requestId: '80000000-0000-4000-8000-000000000001',
            fieldErrors: {
              'body.payoutCents': ['Reward cannot exceed $10.00.'],
            },
          },
          422,
        );
      }
      return jsonResponse(
        decisionResult('APPROVED', { payoutCents: body.payoutCents }),
      );
    };
    renderDetail(fetchImpl);

    fireEvent.changeText(screen.getByLabelText('Reward amount'), '12.00');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(
      await screen.findByText('Reward cannot exceed $10.00.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Reward amount')).toHaveProp('editable', true);

    fireEvent.changeText(screen.getByLabelText('Reward amount'), '3.01');
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Approved $3.01')).toBeVisible();
    expect(sentBodies).toEqual([
      {
        submissionAttemptId: oldAttemptId,
        payoutCents: 1200,
      },
      {
        submissionAttemptId: oldAttemptId,
        payoutCents: 301,
      },
    ]);
  });

  test('cancels post-decision cache effects when the detail screen closes', async () => {
    let finishRequest!: (response: Response) => void;
    const fetchImpl: typeof globalThis.fetch = async (url) => {
      if (String(url).endsWith('/v1/parent/snapshot')) {
        return jsonResponse(approvalSnapshot());
      }
      return new Promise<Response>((resolve) => {
        finishRequest = resolve;
      });
    };
    const { queryClient, unmount } = renderDetail(fetchImpl);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));
    unmount();
    await act(async () => {
      finishRequest(jsonResponse(decisionResult('APPROVED')));
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  test.each(['success', 'failure'] as const)(
    'does not commit late %s state after its decision generation is invalidated',
    async (outcome) => {
      let finish!: () => void;
      let isCurrent = true;
      const writes: string[] = [];
      const action = new Promise<ReturnType<typeof decisionResult>>(
        (resolve, reject) => {
          finish = () => {
            if (outcome === 'success') resolve(decisionResult('APPROVED'));
            else reject(new Error('late failure'));
          };
        },
      );
      const settlement = settleApprovalDecision({
        action: () => action,
        isCurrent: () => isCurrent,
        onResult: () => writes.push('result'),
        onError: () => writes.push('error'),
        onSettled: () => writes.push('settled'),
      });

      isCurrent = false;
      finish();
      await settlement;

      expect(writes).toEqual([]);
    },
  );
});

function renderDetail(fetchImpl: typeof globalThis.fetch) {
  const queryClient = createParentQueryClient(parentSession);
  queryClient.setQueryData(
    familyQueryKeys.parentSnapshot(parentSession),
    approvalSnapshot(),
  );
  trackedQueryClients.push(queryClient);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApprovalDetailScreen
        submissionAttemptId={oldAttemptId}
        session={parentSession}
        fetch={fetchImpl}
      />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? '';
}
