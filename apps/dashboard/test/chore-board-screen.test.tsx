import { fireEvent, render, screen } from '@testing-library/react';

import { ChoreBoardScreen } from '../src/screens/chore-board-screen';
import { dashboardSnapshot } from './test-fixtures';

describe('dashboard chore board', () => {
  test('sorts available chores by creation time then id and shows picture, value, and time', () => {
    const laterChore = dashboardSnapshot.chores[1]!;
    const earlierChore = {
      ...laterChore,
      id: '40000000-0000-4000-8000-000000000003' as typeof laterChore.id,
      choreTemplateId:
        '50000000-0000-4000-8000-000000000003' as typeof laterChore.choreTemplateId,
      name: 'Feed the pet',
      imageKey: 'feed-pet' as const,
      valueCents: 75,
      durationMinutes: 10,
      createdAt: '2026-08-10T11:57:00.000Z',
    };
    const sameTimeLowerId = {
      ...earlierChore,
      id: '40000000-0000-4000-8000-000000000000' as typeof laterChore.id,
      name: 'Set the table',
      imageKey: 'set-table' as const,
    };
    const openChore = vi.fn();

    render(
      <ChoreBoardScreen
        chores={[laterChore, earlierChore, sameTimeLowerId]}
        onOpenChore={openChore}
        onBack={() => undefined}
      />,
    );

    expect(
      screen
        .getAllByRole('button', { name: /open chore/i })
        .map((button) => button.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual([
      'Open chore Set the table $0.75 10 minutes',
      'Open chore Feed the pet $0.75 10 minutes',
      'Open chore Tidy toys $2.00 20 minutes',
    ]);
    expect(screen.getByRole('img', { name: 'Set the table' })).toHaveAttribute(
      'src',
      '/chore-images/set-table.png',
    );

    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    expect(openChore).toHaveBeenCalledWith(laterChore);
  });
});
