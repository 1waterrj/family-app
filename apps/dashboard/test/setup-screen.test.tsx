import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DashboardSessionStore } from '../src/auth/dashboard-session';
import { SetupScreen } from '../src/screens/setup-screen';
import { credentialJson } from './test-fixtures';

function store(): DashboardSessionStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: async () => undefined,
    save: async (session) => {
      saved.push(session);
    },
    clear: async () => undefined,
  };
}

describe('dashboard development setup', () => {
  test('accepts a dashboard credential and binds browser API calls to the same origin', async () => {
    const sessionStore = store();
    const onComplete = vi.fn();
    render(
      <SetupScreen
        sessionStore={sessionStore}
        browserOrigin="http://127.0.0.1:5173"
        onComplete={onComplete}
      />,
    );

    expect(screen.getByLabelText('Dashboard credential JSON')).toHaveAttribute(
      'data-development-credential-import',
      'family-app-development-credential-import',
    );

    fireEvent.change(screen.getByLabelText('Dashboard credential JSON'), {
      target: { value: credentialJson('DASHBOARD') },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(sessionStore.saved).toHaveLength(1);
    expect(sessionStore.saved[0]).toMatchObject({
      apiOrigin: 'http://127.0.0.1:5173',
      role: 'DASHBOARD',
    });
  });

  test('rejects parent credentials without saving them', async () => {
    const sessionStore = store();
    render(
      <SetupScreen
        sessionStore={sessionStore}
        browserOrigin="http://127.0.0.1:5173"
        onComplete={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard credential JSON'), {
      target: { value: credentialJson('PARENT') },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));

    expect(
      await screen.findByText('This dashboard needs a dashboard credential.'),
    ).toBeVisible();
    expect(sessionStore.saved).toEqual([]);
  });
});
