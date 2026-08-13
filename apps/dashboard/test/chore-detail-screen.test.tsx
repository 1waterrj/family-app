import { FamilyApiError } from '@family/api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChoreDetailScreen } from '../src/screens/chore-detail-screen';
import { dashboardSnapshot } from './test-fixtures';

const chore = dashboardSnapshot.chores[1]!;
const primaryChild = dashboardSnapshot.children[0]!;

describe('dashboard chore claim flow', () => {
  test('keeps child choice and confirmation as distinct steps and creates the UUID only when confirmation opens', async () => {
    const claim = vi.fn().mockResolvedValue({ ...chore, status: 'CLAIMED' });
    const createId = vi
      .fn()
      .mockReturnValue('60000000-0000-4000-8000-000000000001');

    render(
      <ChoreDetailScreen
        chore={chore}
        children={dashboardSnapshot.children}
        claim={claim}
        createId={createId}
        isOnline
        isConnectivityPaused={false}
        onClaimed={() => undefined}
        onBack={() => undefined}
        onRefresh={async () => undefined}
      />,
    );

    expect(screen.getByText('Put toys in their bins.')).toBeVisible();
    expect(screen.getByText('$2.00')).toBeVisible();
    expect(screen.getByText('20 minutes')).toBeVisible();
    expect(createId).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    expect(
      screen.getByRole('heading', { name: 'Who is doing it?' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Yes, start it' })).toBeNull();
    expect(createId).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    expect(screen.getByText('Avery will do Tidy toys.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yes, start it' })).toBeVisible();
    expect(createId).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith({
        choreInstanceId: chore.id,
        childId: primaryChild.profile.id,
        idempotencyKey: '60000000-0000-4000-8000-000000000001',
      }),
    );
  });

  test('disables claim confirmation while browser or query connectivity is paused', () => {
    const props = {
      chore,
      children: dashboardSnapshot.children,
      claim: vi.fn(),
      createId: () => '60000000-0000-4000-8000-000000000001',
      onClaimed: () => undefined,
      onBack: () => undefined,
      onRefresh: async () => undefined,
    };
    const view = render(
      <ChoreDetailScreen
        {...props}
        isOnline={false}
        isConnectivityPaused={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    expect(
      screen.getByRole('button', { name: 'Yes, start it' }),
    ).toBeDisabled();

    view.rerender(
      <ChoreDetailScreen {...props} isOnline isConnectivityPaused />,
    );
    expect(
      screen.getByRole('button', { name: 'Yes, start it' }),
    ).toBeDisabled();
  });

  test('retains one operation UUID across an ambiguous retry and discards it on explicit cancel', async () => {
    const claim = vi
      .fn()
      .mockRejectedValueOnce(FamilyApiError.offline())
      .mockResolvedValueOnce({ ...chore, status: 'CLAIMED' });
    const createId = vi
      .fn()
      .mockReturnValueOnce('60000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('60000000-0000-4000-8000-000000000002');
    const onClaimed = vi.fn();

    render(
      <ChoreDetailScreen
        chore={chore}
        children={dashboardSnapshot.children}
        claim={claim}
        createId={createId}
        isOnline
        isConnectivityPaused={false}
        onClaimed={onClaimed}
        onBack={() => undefined}
        onRefresh={async () => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the family server. Try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(onClaimed).toHaveBeenCalledWith(primaryChild.profile.id),
    );
    expect(claim.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    expect(createId).toHaveBeenCalledTimes(3);
  });

  test('maps an unavailable claim to the exact message, refreshes, and returns to the board', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const back = vi.fn();

    render(
      <ChoreDetailScreen
        chore={chore}
        children={dashboardSnapshot.children}
        claim={vi.fn().mockRejectedValue(
          new FamilyApiError('CONFLICT', 'Another helper got there first.', {
            code: 'CHORE_UNAVAILABLE',
          }),
        )}
        createId={() => '60000000-0000-4000-8000-000000000001'}
        isOnline
        isConnectivityPaused={false}
        onClaimed={() => undefined}
        onBack={back}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That chore was just claimed.',
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(back).toHaveBeenCalledTimes(1);
  });

  test('ignores a late claim response after explicit cancellation', async () => {
    let resolveClaim!: (value: unknown) => void;
    const claim = vi.fn(
      () => new Promise((resolve) => (resolveClaim = resolve)),
    );
    const onClaimed = vi.fn();

    render(
      <ChoreDetailScreen
        chore={chore}
        children={dashboardSnapshot.children}
        claim={claim as never}
        createId={() => '60000000-0000-4000-8000-000000000001'}
        isOnline
        isConnectivityPaused={false}
        onClaimed={onClaimed}
        onBack={() => undefined}
        onRefresh={async () => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    resolveClaim({ ...chore, status: 'CLAIMED' });

    await waitFor(() =>
      expect(screen.getByText(chore.instructions)).toBeVisible(),
    );
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
