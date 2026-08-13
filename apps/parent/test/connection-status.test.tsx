import { render, screen } from '@testing-library/react-native';

import { ConnectionStatus } from '../src/components/connection-status';

test('labels stale saved data without blanking the screen', () => {
  render(<ConnectionStatus isOnline isRefreshing={false} isStale hasData />);

  expect(screen.getByText('Saved data — pull to refresh')).toBeVisible();
});
