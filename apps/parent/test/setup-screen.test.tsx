import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { createParentSessionStore } from '../src/auth/session-store';
import { SetupScreen } from '../src/screens/setup-screen';
import {
  createMemoryAsyncStorage,
  createMemorySecureStore,
  encodeDevelopmentCredential,
} from './test-adapters';

describe('development parent setup', () => {
  test('rejects dashboard credentials without replacing the current session', async () => {
    const sessionStore = createParentSessionStore({
      secureStore: createMemorySecureStore(),
      asyncStorage: createMemoryAsyncStorage(),
    });
    let completed = false;
    render(
      <SetupScreen
        sessionStore={sessionStore}
        onComplete={() => (completed = true)}
      />,
    );

    fireEvent.changeText(
      screen.getByLabelText('Credential JSON'),
      encodeDevelopmentCredential('DASHBOARD'),
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Import parent credentials' }),
    );

    expect(
      await screen.findByText('Use a parent development credential.'),
    ).toBeVisible();
    expect(await sessionStore.load()).toBeUndefined();
    expect(completed).toBe(false);
  });

  test('saves a valid parent credential and completes setup', async () => {
    const sessionStore = createParentSessionStore({
      secureStore: createMemorySecureStore(),
      asyncStorage: createMemoryAsyncStorage(),
    });
    let completed = false;
    render(
      <SetupScreen
        sessionStore={sessionStore}
        onComplete={() => (completed = true)}
      />,
    );

    fireEvent.changeText(
      screen.getByLabelText('Credential JSON'),
      encodeDevelopmentCredential('PARENT'),
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Import parent credentials' }),
    );

    await waitFor(() => expect(completed).toBe(true));
    expect(await sessionStore.load()).toEqual({
      apiOrigin: 'http://127.0.0.1:3000',
      accessToken: expect.any(String),
      actorId: '10000000-0000-4000-8000-000000000001',
      householdId: '20000000-0000-4000-8000-000000000001',
      role: 'PARENT',
    });
  });
});
