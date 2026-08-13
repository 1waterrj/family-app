import { FamilyApiError } from '@family/api-client';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { ActiveChoreScreen } from '../src/screens/active-chore-screen';
import { dashboardSnapshot } from './test-fixtures';

const claimed = dashboardSnapshot.chores[0]!;
const primaryChild = dashboardSnapshot.children[0]!;
const secondaryChild = dashboardSnapshot.children[1]!;

describe('active dashboard chore', () => {
  test("shows I'm done only to the child who owns the claim", () => {
    const props = {
      chore: claimed,
      child: primaryChild,
      serverOffsetMs: 0,
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
      submit: vi.fn(),
      createId: () => '60000000-0000-4000-8000-000000000001',
      onSubmitted: () => undefined,
      onBack: () => undefined,
      onRefresh: () => undefined,
    };
    const view = render(<ActiveChoreScreen {...props} />);
    expect(screen.getByRole('button', { name: "I'm done" })).toBeVisible();

    view.rerender(<ActiveChoreScreen {...props} child={secondaryChild} />);
    expect(screen.queryByRole('button', { name: "I'm done" })).toBeNull();
  });

  test('requires a second tap and retains the submission UUID across retry', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(FamilyApiError.offline())
      .mockResolvedValueOnce({
        ...claimed,
        status: 'AWAITING_APPROVAL',
        submissionAttemptId: '70000000-0000-4000-8000-000000000001',
      });
    const createId = vi
      .fn()
      .mockReturnValue('60000000-0000-4000-8000-000000000001');

    render(
      <ActiveChoreScreen
        chore={claimed}
        child={primaryChild}
        serverOffsetMs={0}
        now={() => Date.parse('2026-08-10T12:00:00.000Z')}
        submit={submit}
        createId={createId}
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText('Tell a grown-up this chore is finished?'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I finished' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the family server. Try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
    ]);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  test('disables submission confirmation while connectivity is paused', () => {
    render(
      <ActiveChoreScreen
        chore={claimed}
        child={primaryChild}
        serverOffsetMs={0}
        now={() => Date.parse('2026-08-10T12:00:00.000Z')}
        submit={vi.fn()}
        createId={() => '60000000-0000-4000-8000-000000000001'}
        isOnline
        isConnectivityPaused
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    expect(
      screen.getByRole('button', { name: 'Yes, I finished' }),
    ).toBeDisabled();
  });

  test('renders the waiting state without a submission action', () => {
    render(
      <ActiveChoreScreen
        chore={{
          ...claimed,
          status: 'AWAITING_APPROVAL',
          submittedAt: '2026-08-10T12:01:00.000Z',
        }}
        child={primaryChild}
        serverOffsetMs={0}
        now={() => Date.parse('2026-08-10T12:02:00.000Z')}
        submit={vi.fn()}
        createId={() => '60000000-0000-4000-8000-000000000001'}
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText('Waiting for a grown-up.')).toBeVisible();
    expect(screen.queryByRole('button', { name: "I'm done" })).toBeNull();
  });

  test('shows the server-checking label at zero and invalidates once without changing the chore status', () => {
    vi.useFakeTimers();
    let now = Date.parse('2026-08-10T12:14:59.000Z');
    const refresh = vi.fn();
    const ownedChore = { ...claimed };

    render(
      <ActiveChoreScreen
        chore={ownedChore}
        child={primaryChild}
        serverOffsetMs={0}
        now={() => now}
        submit={vi.fn()}
        createId={() => '60000000-0000-4000-8000-000000000001'}
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={refresh}
      />,
    );
    expect(screen.getByText('1 second')).toBeVisible();

    now = Date.parse('2026-08-10T12:15:00.000Z');
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('Checking with the family server…')).toBeVisible();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(3_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ownedChore.status).toBe('CLAIMED');
    vi.useRealTimers();
  });
});
