import {
  FamilyApiError,
  familyQueryKeys,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import {
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  type FeedbackPublicPreview,
  type FeedbackReport,
} from '@family/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import {
  loadMaintainerToolsEnabled,
  setMaintainerToolsEnabled,
} from '../src/features/feedback/maintainer-settings';
import { FeedbackExportScreen } from '../src/screens/feedback-export-screen';
import { createMemoryAsyncStorage } from './test-adapters';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'must-never-reach-github',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};
const feedbackReport = FeedbackReportSchema.parse({
  id: '30000000-0000-4000-8000-000000000001',
  category: 'BROKEN',
  source: 'PARENT_IOS',
  appVersion: '1.2.3',
  screen: 'PARENT_HOME',
  status: 'READY',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T13:00:00.000Z',
  title: 'Something broke',
  description: 'The connection action did not respond.',
  diagnosticSnapshot: {
    source: 'PARENT_IOS',
    appVersion: '1.2.3',
    currentScreen: 'PARENT_HOME',
    events: [
      {
        kind: 'NETWORK',
        at: '2026-08-10T11:59:30.000Z',
        state: 'OFFLINE',
      },
    ],
  },
  privacyFindings: [],
  publicIssueUrl: null,
  reviewedAt: '2026-08-10T13:00:00.000Z',
  exportedAt: null,
  closedAt: null,
});
const validatedPreview = FeedbackPublicPreviewSchema.parse({
  repositoryUrl: 'https://github.com/family/app',
  title: 'Sanitized connection bug',
  body: '## Description\n\nThe connection action did not respond.',
  labels: ['feedback', 'app:parent', 'platform:ios', 'type:bug'],
  redactions: ['KNOWN_PRIVATE_TERM'],
});

function exportedReport(): FeedbackReport {
  return FeedbackReportSchema.parse({
    ...feedbackReport,
    status: 'EXPORTED',
    exportedAt: '2026-08-10T14:00:00.000Z',
    updatedAt: '2026-08-10T14:00:00.000Z',
  });
}

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('maintainer-only public feedback handoff', () => {
  test('defaults maintainer tools off in a fresh device store', async () => {
    // Break caught: GitHub export silently appears on every parent's phone.
    const storage = createMemoryAsyncStorage();
    await expect(loadMaintainerToolsEnabled(storage)).resolves.toBe(false);
    await setMaintainerToolsEnabled(storage, true);
    await expect(loadMaintainerToolsEnabled(storage)).resolves.toBe(true);
    await setMaintainerToolsEnabled(storage, false);
    await expect(loadMaintainerToolsEnabled(storage)).resolves.toBe(false);
  });

  test('fails closed without loading private detail when export is opened on a non-maintainer phone', () => {
    // Break caught: a deep link bypasses the device-local maintainer display gate.
    const client = exportClient();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Number.POSITIVE_INFINITY,
        },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    trackedQueryClients.push(queryClient);
    render(
      <FeedbackExportScreen
        feedbackId={feedbackReport.id}
        session={parentSession}
        fetch={unusedFetch}
        client={client}
        maintainerToolsEnabled={false}
      />,
      { wrapper: queryWrapper(queryClient) },
    );

    expect(
      screen.getByText('Maintainer tools are disabled on this phone.'),
    ).toBeVisible();
    expect(client.getFeedback).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /GitHub/i })).toBeNull();
  });

  test('invalidates exact server preview on every edit and disables handoff until revalidated', async () => {
    // Break caught: stale sanitized output can be copied or opened after private draft edits.
    let resolveSecondPreview!: (preview: FeedbackPublicPreview) => void;
    const prepareFeedbackPublicPreview = jest
      .fn()
      .mockResolvedValueOnce(validatedPreview)
      .mockImplementationOnce(
        () =>
          new Promise<FeedbackPublicPreview>((resolve) => {
            resolveSecondPreview = resolve;
          }),
      );
    renderExport({ client: exportClient({ prepareFeedbackPublicPreview }) });

    const continueButton = await screen.findByRole('button', {
      name: 'Continue to GitHub',
    });
    const copyButton = screen.getByRole('button', {
      name: 'Copy validated Markdown',
    });
    expect(continueButton).toBeDisabled();
    expect(copyButton).toBeDisabled();

    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    expect(await screen.findByText(validatedPreview.title)).toBeVisible();
    expect(screen.getByText(validatedPreview.body)).toBeVisible();
    expect(
      screen.getByText('feedback, app:parent, platform:ios, type:bug'),
    ).toBeVisible();
    expect(prepareFeedbackPublicPreview).toHaveBeenNthCalledWith(
      1,
      feedbackReport.id,
      {
        publicTitle: feedbackReport.title,
        publicDescription: feedbackReport.description,
        includeDiagnostics: true,
      },
    );
    expect(continueButton).toBeEnabled();
    expect(copyButton).toBeEnabled();

    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'A newly edited title',
    );
    expect(screen.queryByText(validatedPreview.title)).toBeNull();
    expect(continueButton).toBeDisabled();
    expect(copyButton).toBeDisabled();

    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    expect(continueButton).toBeDisabled();
    expect(prepareFeedbackPublicPreview).toHaveBeenNthCalledWith(
      2,
      feedbackReport.id,
      {
        publicTitle: 'A newly edited title',
        publicDescription: feedbackReport.description,
        includeDiagnostics: true,
      },
    );
    await act(async () => resolveSecondPreview(validatedPreview));
    expect(continueButton).toBeEnabled();

    fireEvent.changeText(
      screen.getByLabelText('Public description'),
      'Edited once more.',
    );
    expect(continueButton).toBeDisabled();
    expect(copyButton).toBeDisabled();
  });

  test('discards a preview response that returns after the draft changed', async () => {
    // Break caught: a late response validates an older public draft and re-enables export for newer text.
    let resolvePreview!: (preview: FeedbackPublicPreview) => void;
    const prepareFeedbackPublicPreview = jest.fn(
      () =>
        new Promise<FeedbackPublicPreview>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    renderExport({ client: exportClient({ prepareFeedbackPublicPreview }) });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await waitFor(() =>
      expect(prepareFeedbackPublicPreview).toHaveBeenCalledTimes(1),
    );
    fireEvent.changeText(
      screen.getByLabelText('Public description'),
      'Text changed while validation was running.',
    );

    await act(async () => resolvePreview(validatedPreview));

    expect(screen.queryByText(validatedPreview.title)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue to GitHub' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    ).toBeDisabled();
  });

  test('adopts a newer same-report server scrub when the export draft is clean and rejects its stale preview', async () => {
    // Break caught: same-ID refetches are ignored, leaving old private text and a stale validation eligible for handoff.
    let resolvePreview!: (preview: FeedbackPublicPreview) => void;
    const prepareFeedbackPublicPreview = jest.fn(
      () =>
        new Promise<FeedbackPublicPreview>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { queryClient } = renderExport({
      client: exportClient({ prepareFeedbackPublicPreview }),
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await waitFor(() =>
      expect(prepareFeedbackPublicPreview).toHaveBeenCalledTimes(1),
    );

    const secondParentScrub = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'Second parent sanitized title',
      description: 'Second parent removed the private detail.',
      diagnosticSnapshot: {
        ...feedbackReport.diagnosticSnapshot,
        events: [],
      },
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    act(() => {
      queryClient.setQueryData(
        familyQueryKeys.feedbackDetail(parentSession, feedbackReport.id),
        secondParentScrub,
      );
    });

    expect(
      await screen.findByDisplayValue('Second parent sanitized title'),
    ).toBeVisible();
    expect(
      screen.getByDisplayValue('Second parent removed the private detail.'),
    ).toBeVisible();
    expect(
      screen.getByLabelText('Include sanitized diagnostics'),
    ).not.toBeChecked();

    await act(async () => resolvePreview(validatedPreview));

    expect(screen.queryByText(validatedPreview.title)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue to GitHub' }),
    ).toBeDisabled();
  });

  test('preserves a dirty export draft but blocks handoff until the newer server scrub is explicitly rebased', async () => {
    // Break caught: a second parent's scrub is silently ignored while local edits can still be validated and exported.
    const prepareFeedbackPublicPreview = jest
      .fn()
      .mockResolvedValue(validatedPreview);
    const { queryClient } = renderExport({
      client: exportClient({ prepareFeedbackPublicPreview }),
    });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'Keep my local public title',
    );

    const secondParentScrub = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'New canonical private title',
      description: 'New canonical private description.',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    act(() => {
      queryClient.setQueryData(
        familyQueryKeys.feedbackDetail(parentSession, feedbackReport.id),
        secondParentScrub,
      );
    });

    expect(
      screen.getByDisplayValue('Keep my local public title'),
    ).toBeVisible();
    expect(
      await screen.findByRole('alert', {
        name: 'This feedback changed on the server while you were editing. Resolve the conflict before preparing a public preview.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Prepare preview' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Continue to GitHub' }),
    ).toBeDisabled();
    expect(prepareFeedbackPublicPreview).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Keep my draft' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByDisplayValue('Keep my local public title'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Prepare preview' }),
    ).toBeEnabled();
    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    await waitFor(() =>
      expect(prepareFeedbackPublicPreview).toHaveBeenCalledWith(
        feedbackReport.id,
        {
          publicTitle: 'Keep my local public title',
          publicDescription: feedbackReport.description,
          includeDiagnostics: true,
        },
      ),
    );
  });

  test('copies the validated Markdown before marking the reviewed revision EXPORTED', async () => {
    // Break caught: standalone copy leaves the local timeline at READY or marks it before the native clipboard succeeds.
    const calls: string[] = [];
    const setStringAsync = jest.fn(async (markdown: string) => {
      calls.push(`copy:${markdown}`);
    });
    const updateFeedback = jest.fn(async (_id, input) => {
      calls.push(`mark:${input.status}`);
      return exportedReport();
    });
    renderExport({
      client: exportClient({ updateFeedback }),
      clipboard: { setStringAsync },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.body);

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    );

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    expect(setStringAsync).toHaveBeenCalledWith(
      `${validatedPreview.title}\n\n${validatedPreview.body}`,
    );
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      status: 'EXPORTED',
    });
    expect(calls.map((entry) => entry.split(':')[0])).toEqual(['copy', 'mark']);
    expect(await screen.findByText(/copied/i)).toBeVisible();
    expect(screen.queryByText(/published/i)).toBeNull();
  });

  test.each([
    ['returns false', jest.fn().mockResolvedValue(false)],
    ['throws', jest.fn().mockRejectedValue(new Error('clipboard unavailable'))],
  ])(
    'does not mark standalone copy EXPORTED when the clipboard %s',
    async (_case, setStringAsync) => {
      // Break caught: a failed native clipboard write is recorded as a completed local export.
      const updateFeedback = jest.fn();
      renderExport({
        client: exportClient({ updateFeedback }),
        clipboard: { setStringAsync },
      });
      fireEvent.press(
        await screen.findByRole('button', { name: 'Prepare preview' }),
      );
      await screen.findByText(validatedPreview.body);

      fireEvent.press(
        screen.getByRole('button', { name: 'Copy validated Markdown' }),
      );

      expect(
        await screen.findByRole('alert', {
          name: 'The validated Markdown could not be copied.',
        }),
      ).toBeVisible();
      expect(updateFeedback).not.toHaveBeenCalled();
      expect(screen.getByText(validatedPreview.body)).toBeVisible();
    },
  );

  test('preserves a copied preview and retries its one stable CAS command without recopying', async () => {
    // Break caught: transport failure either loses the copied draft, generates a new mutation identity, or makes the parent copy again.
    const setStringAsync = jest.fn().mockResolvedValue(undefined);
    const updateFeedback = jest
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(exportedReport());
    renderExport({
      client: exportClient({ updateFeedback }),
      clipboard: { setStringAsync },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.body);

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    );

    expect(
      await screen.findByRole('alert', {
        name: 'Validated Markdown was copied, but the local status was not updated. Retry marking it exported without copying again.',
      }),
    ).toBeVisible();
    expect(screen.getByText(validatedPreview.body)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry marking copied draft' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Continue to GitHub' }),
    ).toBeDisabled();

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry marking copied draft' }),
    );

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback.mock.calls[0]).toEqual(updateFeedback.mock.calls[1]);
    expect(setStringAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/copied/i)).toBeVisible();
  });

  test('refreshes a standalone-copy CAS conflict and blocks the copied draft against the later remote revision', async () => {
    // Break caught: copy status overwrites a newer scrub or treats the conflict as a retryable transport failure.
    const newerReport = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'Another parent scrubbed the private title',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockResolvedValueOnce(newerReport);
    const updateFeedback = jest.fn().mockRejectedValue(
      new FamilyApiError('CONFLICT', 'Feedback changed on the server.', {
        code: 'CONFLICT',
      }),
    );
    renderExport({
      client: exportClient({ getFeedback, updateFeedback }),
    });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'Keep my reviewed public title',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    await screen.findByText(validatedPreview.body);

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    );

    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      status: 'EXPORTED',
    });
    expect(
      await screen.findByText(
        'This feedback changed on the server while you were editing. Resolve the conflict before preparing a public preview.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Retry marking copied draft' }),
    ).toBeNull();
  });

  test('coalesces repeated copy presses and does not start status work after unmount', async () => {
    // Break caught: rapid taps duplicate native writes/mutations or a late clipboard completion mutates an unmounted screen.
    let resolveClipboard!: (value: void) => void;
    const setStringAsync = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClipboard = resolve;
        }),
    );
    const updateFeedback = jest.fn();
    const view = renderExport({
      client: exportClient({ updateFeedback }),
      clipboard: { setStringAsync },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.body);
    const copy = screen.getByRole('button', {
      name: 'Copy validated Markdown',
    });

    fireEvent.press(copy);
    fireEvent.press(copy);
    await waitFor(() => expect(setStringAsync).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => resolveClipboard());

    expect(updateFeedback).not.toHaveBeenCalled();
  });

  test('opens the encoded server-validated preview and only then marks EXPORTED', async () => {
    // Break caught: handoff invents public content, leaks the API token, or claims publication.
    const calls: string[] = [];
    const openURL = jest.fn(async (url: string) => {
      calls.push(`open:${url}`);
    });
    const updateFeedback = jest.fn(async (_id, input) => {
      calls.push(`mark:${input.status}`);
      return { ...feedbackReport, status: 'EXPORTED' as const };
    });
    renderExport({
      client: exportClient({ updateFeedback }),
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.title);

    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    const openedUrl = openURL.mock.calls[0]?.[0] ?? '';
    expect(openedUrl).toContain('https://github.com/family/app/issues/new?');
    const opened = new URL(openedUrl);
    expect(opened.searchParams.get('title')).toBe(validatedPreview.title);
    expect(opened.searchParams.get('body')).toBe(validatedPreview.body);
    expect(openedUrl).not.toContain(parentSession.accessToken);
    expect(calls[0]).toMatch(/^open:/);
    expect(calls[1]).toBe('mark:EXPORTED');
    expect(await screen.findByText(/Opened GitHub/)).toBeVisible();
    expect(screen.queryByText(/published/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    ).toBeDisabled();
  });

  test('coalesces repeated browser presses and does not mark after unmount', async () => {
    // Break caught: rapid GitHub taps open multiple composers or a late native return mutates local status after navigation away.
    let resolveOpen!: (value: void) => void;
    const openURL = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const updateFeedback = jest.fn();
    const view = renderExport({
      client: exportClient({ updateFeedback }),
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.body);
    const continueButton = screen.getByRole('button', {
      name: 'Continue to GitHub',
    });

    fireEvent.press(continueButton);
    fireEvent.press(continueButton);
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => resolveOpen());

    expect(updateFeedback).not.toHaveBeenCalled();
  });

  test('acknowledges its own canonical EXPORTED revision without discarding a dirty public draft', async () => {
    // Break caught: the successful handoff's own updatedAt change is misclassified as another parent's edit conflict.
    let resolveCanonicalRefetch!: (report: FeedbackReport) => void;
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockImplementationOnce(
        () =>
          new Promise<FeedbackReport>((resolve) => {
            resolveCanonicalRefetch = resolve;
          }),
      );
    const exportedCanonical = FeedbackReportSchema.parse({
      ...feedbackReport,
      status: 'EXPORTED',
      exportedAt: '2026-08-10T14:00:00.000Z',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const updateFeedback = jest.fn().mockResolvedValue(exportedCanonical);
    renderExport({ client: exportClient({ getFeedback, updateFeedback }) });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'My reviewed public title',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    await screen.findByText(validatedPreview.title);

    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      status: 'EXPORTED',
    });
    expect(screen.getByDisplayValue('My reviewed public title')).toBeVisible();
    expect(
      screen.queryByText(/changed on the server while you were editing/i),
    ).toBeNull();

    await act(async () => resolveCanonicalRefetch(exportedCanonical));

    expect(await screen.findByText(/Opened GitHub/)).toBeVisible();
    expect(screen.getByDisplayValue('My reviewed public title')).toBeVisible();
    expect(
      screen.queryByText(/changed on the server while you were editing/i),
    ).toBeNull();
  });

  test('still blocks handoff when a newer other-parent revision races after its own EXPORTED response', async () => {
    // Break caught: acknowledging the local status update also suppresses a genuinely newer canonical scrub.
    let resolveRemoteRevision!: (report: FeedbackReport) => void;
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockImplementationOnce(
        () =>
          new Promise<FeedbackReport>((resolve) => {
            resolveRemoteRevision = resolve;
          }),
      );
    const exportedCanonical = FeedbackReportSchema.parse({
      ...feedbackReport,
      status: 'EXPORTED',
      exportedAt: '2026-08-10T14:00:00.000Z',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const remoteScrub = FeedbackReportSchema.parse({
      ...exportedCanonical,
      title: 'Another parent scrubbed this title',
      description: 'Another parent scrubbed this description.',
      updatedAt: '2026-08-10T15:00:00.000Z',
    });
    const updateFeedback = jest.fn().mockResolvedValue(exportedCanonical);
    renderExport({
      client: exportClient({ getFeedback, updateFeedback }),
    });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'Keep this local reviewed title',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    await screen.findByText(validatedPreview.title);
    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(/changed on the server while you were editing/i),
    ).toBeNull();

    await act(async () => resolveRemoteRevision(remoteScrub));

    expect(
      await screen.findByRole('alert', {
        name: 'This feedback changed on the server while you were editing. Resolve the conflict before preparing a public preview.',
      }),
    ).toBeVisible();
    expect(
      screen.getByDisplayValue('Keep this local reviewed title'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue to GitHub' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    ).toBeDisabled();
  });

  test('sends the reviewed revision and refreshes a structured export-status conflict for rebasing', async () => {
    // Break caught: export status overwrites a newer scrub or leaves a generic dead end after CAS rejection.
    const newerReport = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'Another parent scrubbed the private title',
      description: 'Another parent scrubbed the private description.',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockResolvedValueOnce(newerReport);
    const updateFeedback = jest.fn().mockRejectedValue(
      new FamilyApiError('CONFLICT', 'Feedback changed on the server.', {
        code: 'CONFLICT',
      }),
    );
    renderExport({
      client: exportClient({ getFeedback, updateFeedback }),
    });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Public title'),
      'Keep my reviewed public title',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Prepare preview' }));
    await screen.findByText(validatedPreview.title);
    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      status: 'EXPORTED',
    });
    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        'This feedback changed on the server while you were editing. Resolve the conflict before preparing a public preview.',
      ),
    ).toBeVisible();
  });

  test('copies an oversize validated draft and opens the blank composer before marking EXPORTED', async () => {
    // Break caught: oversize handoff truncates content or marks export before clipboard/browser success.
    const longPreview = FeedbackPublicPreviewSchema.parse({
      ...validatedPreview,
      body: '✓'.repeat(5_000),
    });
    const calls: string[] = [];
    const setStringAsync = jest.fn(async (markdown: string) => {
      calls.push(`copy:${markdown}`);
    });
    const openURL = jest.fn(async (url: string) => {
      calls.push(`open:${url}`);
    });
    const updateFeedback = jest.fn(async (_id, input) => {
      calls.push(`mark:${input.status}`);
      return { ...feedbackReport, status: 'EXPORTED' as const };
    });
    renderExport({
      client: exportClient({
        prepareFeedbackPublicPreview: jest.fn().mockResolvedValue(longPreview),
        updateFeedback,
      }),
      clipboard: { setStringAsync },
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(longPreview.body);
    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    expect(setStringAsync).toHaveBeenCalledWith(
      `${longPreview.title}\n\n${longPreview.body}`,
    );
    expect(openURL).toHaveBeenCalledWith(
      'https://github.com/family/app/issues/new',
    );
    expect(calls.map((entry) => entry.split(':')[0])).toEqual([
      'copy',
      'open',
      'mark',
    ]);
  });

  test('marks an oversize draft EXPORTED after copy even when the subsequent blank composer fails', async () => {
    // Break caught: a completed validated copy is lost from the local export timeline merely because the optional browser step failed.
    const longPreview = FeedbackPublicPreviewSchema.parse({
      ...validatedPreview,
      body: '✓'.repeat(5_000),
    });
    const setStringAsync = jest.fn().mockResolvedValue(undefined);
    const openURL = jest.fn().mockRejectedValue(new Error('no browser'));
    const updateFeedback = jest.fn().mockResolvedValue(exportedReport());
    renderExport({
      client: exportClient({
        prepareFeedbackPublicPreview: jest.fn().mockResolvedValue(longPreview),
        updateFeedback,
      }),
      clipboard: { setStringAsync },
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(longPreview.body);

    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    expect(setStringAsync).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      status: 'EXPORTED',
    });
    expect(screen.getByText(longPreview.body)).toBeVisible();
    expect(screen.queryByText(/published/i)).toBeNull();
  });

  test('keeps validated Markdown visible and does not mark export when the browser fails', async () => {
    // Break caught: a failed OS handoff loses the only safe draft or falsely records export.
    const openURL = jest.fn().mockRejectedValue(new Error('no browser'));
    const updateFeedback = jest.fn();
    renderExport({
      client: exportClient({ updateFeedback }),
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(validatedPreview.body);
    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    expect(
      await screen.findByRole('alert', {
        name: 'GitHub could not be opened. The validated Markdown is still available to copy.',
      }),
    ).toBeVisible();
    expect(screen.getByText(validatedPreview.body)).toBeVisible();
    expect(updateFeedback).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Copy validated Markdown' }),
    ).toBeEnabled();
  });

  test('does not open or mark export when the clipboard reports a failed oversize copy', async () => {
    // Break caught: a false native clipboard result is treated as success and loses the oversize handoff body.
    const longPreview = FeedbackPublicPreviewSchema.parse({
      ...validatedPreview,
      body: '✓'.repeat(5_000),
    });
    const setStringAsync = jest.fn().mockResolvedValue(false);
    const openURL = jest.fn();
    const updateFeedback = jest.fn();
    renderExport({
      client: exportClient({
        prepareFeedbackPublicPreview: jest.fn().mockResolvedValue(longPreview),
        updateFeedback,
      }),
      clipboard: { setStringAsync },
      linking: { openURL },
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare preview' }),
    );
    await screen.findByText(longPreview.body);

    fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));

    expect(
      await screen.findByRole('alert', {
        name: 'The validated Markdown could not be copied, so GitHub was not opened.',
      }),
    ).toBeVisible();
    expect(openURL).not.toHaveBeenCalled();
    expect(updateFeedback).not.toHaveBeenCalled();
    expect(screen.getByText(longPreview.body)).toBeVisible();
  });
});

function renderExport({
  client,
  linking = { openURL: jest.fn().mockResolvedValue(undefined) },
  clipboard = { setStringAsync: jest.fn().mockResolvedValue(undefined) },
}: {
  client: Pick<
    FamilyApiClient,
    'getFeedback' | 'prepareFeedbackPublicPreview' | 'updateFeedback'
  >;
  linking?: { openURL(url: string): Promise<unknown> };
  clipboard?: { setStringAsync(value: string): Promise<boolean | void> };
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
  trackedQueryClients.push(queryClient);
  const view = render(
    <FeedbackExportScreen
      feedbackId={feedbackReport.id}
      session={parentSession}
      fetch={unusedFetch}
      client={client}
      maintainerToolsEnabled
      linking={linking}
      clipboard={clipboard}
      randomUUID={() => '50000000-0000-4000-8000-000000000001'}
    />,
    { wrapper: queryWrapper(queryClient) },
  );
  return { ...view, queryClient };
}

function exportClient(
  overrides: Partial<
    Pick<
      FamilyApiClient,
      'getFeedback' | 'prepareFeedbackPublicPreview' | 'updateFeedback'
    >
  > = {},
): Pick<
  FamilyApiClient,
  'getFeedback' | 'prepareFeedbackPublicPreview' | 'updateFeedback'
> {
  return {
    getFeedback: jest.fn().mockResolvedValue(feedbackReport),
    prepareFeedbackPublicPreview: jest.fn().mockResolvedValue(validatedPreview),
    updateFeedback: jest.fn().mockResolvedValue({
      ...feedbackReport,
      status: 'EXPORTED',
    }),
    ...overrides,
  };
}

function queryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const unusedFetch: typeof globalThis.fetch = async () =>
  new Response(null, { status: 204 });
