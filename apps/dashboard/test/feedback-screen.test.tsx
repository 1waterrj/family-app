import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { FeedbackScreen } from '../src/screens/feedback-screen';

describe('dashboard feedback screen', () => {
  test('offers three exact accessible choices, optional text, and keyboard-safe close controls', () => {
    // Break caught: a child cannot identify/select a category or leave the modal without a pointer.
    const onClose = vi.fn();
    render(
      <FeedbackScreen
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue({ status: 'delivered' })}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Tell us' });
    const back = screen.getByRole('button', { name: 'Back' });
    const privacySummary = screen.getByText('What gets sent?');
    expect(back).toHaveFocus();
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(privacySummary).toHaveFocus();
    fireEvent.keyDown(privacySummary, { key: 'Tab' });
    expect(back).toHaveFocus();
    const broken = screen.getByRole('button', { name: 'Something broke' });
    const confusing = screen.getByRole('button', {
      name: 'This is confusing',
    });
    const idea = screen.getByRole('button', { name: 'I have an idea' });
    expect(broken).toHaveAttribute('aria-pressed', 'false');
    expect(confusing).toHaveAttribute('aria-pressed', 'false');
    expect(idea).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Send feedback' }),
    ).toBeDisabled();

    fireEvent.click(confusing);

    expect(confusing).toHaveAttribute('aria-pressed', 'true');
    expect(confusing).toHaveTextContent('Selected');
    expect(broken).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
    expect(screen.getByLabelText('Tell us more (optional)')).toHaveAttribute(
      'maxlength',
      '2000',
    );
    fireEvent.click(screen.getByText('What gets sent?'));
    expect(
      screen.getByText(/15 minutes, 100 events, and 24 KiB/i),
    ).toBeVisible();
    expect(
      screen.getByText(
        /never include names, chore notes, balances, credentials, web addresses, or request and response bodies/i,
      ),
    ).toBeVisible();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('ignores a deferred submit result after Escape closes the screen', async () => {
    // Break caught: the settled request writes into a screen whose close lifetime has ended.
    let resolveSubmission!: (result: { status: 'delivered' }) => void;
    const submission = new Promise<{ status: 'delivered' }>((resolve) => {
      resolveSubmission = resolve;
    });
    const onClose = vi.fn();
    render(
      <FeedbackScreen onClose={onClose} onSubmit={vi.fn(() => submission)} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Tell us' }), {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSubmission({ status: 'delivered' });
      await submission;
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByText('Thanks - your feedback was saved and sent.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Something broke' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('submits a choice without text and shows only an honest acknowledgement', async () => {
    // Break caught: optional text is treated as required or the child sees private review/export data.
    const onSubmit = vi.fn().mockResolvedValue({ status: 'delivered' });
    render(<FeedbackScreen onClose={() => undefined} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(
      await screen.findByText('Thanks - your feedback was saved and sent.'),
    ).toBeVisible();
    expect(onSubmit).toHaveBeenCalledWith({
      category: 'BROKEN',
      description: '',
    });
    expect(
      screen.queryByText(/github|export|inbox|maintainer|edit|delete/i),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      'queued',
      'Your feedback was saved. We will send it when the family server reconnects.',
    ],
    ['rate-limited', "Your feedback was saved. We'll try again later."],
    [
      'saved',
      'Your feedback was saved. We could not check whether it sent yet.',
    ],
  ] as const)('announces a truthful %s result', async (status, message) => {
    // Break caught: a durable local save is falsely announced as delivered.
    render(
      <FeedbackScreen
        onClose={() => undefined}
        onSubmit={vi.fn().mockResolvedValue({ status })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByText(message)).toBeVisible();
  });

  test('keeps the unsaved choice and text when local storage fails', async () => {
    // Break caught: a failed durable enqueue erases the child's only copy of the report.
    render(
      <FeedbackScreen
        onClose={() => undefined}
        onSubmit={vi.fn().mockRejectedValue(new Error('storage unavailable'))}
      />,
    );
    const description = screen.getByLabelText('Tell us more (optional)');
    fireEvent.click(screen.getByRole('button', { name: 'I have an idea' }));
    fireEvent.change(description, {
      target: { value: 'Please keep these words.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Feedback could not be saved. Your words are still here. Try again.',
    );
    expect(description).toHaveValue('Please keep these words.');
    expect(
      screen.getByRole('button', { name: 'I have an idea' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send feedback' }),
      ).toBeEnabled(),
    );
  });
});
