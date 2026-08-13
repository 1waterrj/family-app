import { familyQueryKeys } from '@family/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';

import { createParentQueryClient } from '../src/query/create-query-client';
import { ApprovalsScreen } from '../src/screens/approvals-screen';
import {
  approvalSnapshot,
  jsonResponse,
  oldAttemptId,
  parentSession,
} from './approval-fixtures';

const trackedQueryClients: QueryClient[] = [];

afterEach(async () => {
  cleanup();
  for (const queryClient of trackedQueryClients.splice(0)) {
    await queryClient.cancelQueries();
    queryClient.clear();
  }
  jest.useRealTimers();
});

describe('approval inbox', () => {
  test('shows pending submissions oldest first with picture, amount, submitted time, and claimed elapsed time', async () => {
    const onReview = jest.fn();
    renderInbox({ onReview });

    const reviewButtons = await screen.findAllByRole('button', {
      name: /^Review /,
    });
    expect(
      reviewButtons.map((button) => button.props.accessibilityLabel),
    ).toEqual(['Review Tidy toys for Avery', 'Review Dishes for Riley']);
    expect(screen.getByText('Proposed reward $2.00')).toBeVisible();
    expect(screen.getByText('Completed in 10 minutes')).toBeVisible();
    expect(screen.getAllByText(/^Submitted /)).toHaveLength(2);
    expect(screen.getByLabelText('Tidy toys chore picture')).toBeVisible();
    expect(screen.queryByText(/Completed in 0 minutes/)).toBeNull();

    fireEvent.press(reviewButtons[0]!);
    expect(onReview).toHaveBeenCalledWith(oldAttemptId);
  });

  test('polls every fifteen seconds only while active with pending approvals and invalidates once on foreground return', async () => {
    jest.useFakeTimers();
    const appState = createFakeAppState('active');
    const fetchImpl = jest.fn(async () => jsonResponse(approvalSnapshot()));
    const { queryClient } = renderInbox({ fetchImpl, appState });

    await screen.findByText('Tidy toys');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    act(() => appState.change('background'));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    act(() => appState.change('active'));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.parentSnapshot(parentSession),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    queryClient.setQueryData(familyQueryKeys.parentSnapshot(parentSession), {
      ...approvalSnapshot(),
      pendingApprovals: [],
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

function renderInbox({
  fetchImpl = async () => jsonResponse(approvalSnapshot()),
  onReview = () => undefined,
  appState,
}: {
  fetchImpl?: typeof globalThis.fetch;
  onReview?: (submissionAttemptId: string) => void;
  appState?: ReturnType<typeof createFakeAppState>;
} = {}) {
  const queryClient = createParentQueryClient(parentSession);
  trackedQueryClients.push(queryClient);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsScreen
        session={parentSession}
        fetch={fetchImpl}
        onReview={onReview}
        appState={appState}
      />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function createFakeAppState(initial: AppStateStatus) {
  let currentState = initial;
  const listeners = new Set<(state: AppStateStatus) => void>();
  return {
    get currentState() {
      return currentState;
    },
    addEventListener: (
      _event: 'change',
      listener: (state: AppStateStatus) => void,
    ) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    change: (next: AppStateStatus) => {
      currentState = next;
      for (const listener of listeners) listener(next);
    },
  };
}
