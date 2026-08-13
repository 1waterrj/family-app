import type { ClientSession, FamilyApiClient } from '@family/api-client';
import {
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  type CreateFeedbackCommand,
  type FeedbackListItem,
  type FeedbackPublicPreview,
  type FeedbackReport,
  type FeedbackSource,
  type UpdateFeedbackCommand,
} from '@family/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ParentFeedbackProvider } from '../src/features/feedback/feedback-runtime';
import {
  loadMaintainerToolsEnabled,
  setMaintainerToolsEnabled,
} from '../src/features/feedback/maintainer-settings';
import { FeedbackDetailScreen } from '../src/screens/feedback-detail-screen';
import { FeedbackExportScreen } from '../src/screens/feedback-export-screen';
import { FeedbackInboxScreen } from '../src/screens/feedback-inbox-screen';
import { SendFeedbackScreen } from '../src/screens/send-feedback-screen';
import { createMemoryAsyncStorage } from './test-adapters';

const session: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'native-acceptance-token-must-stay-local',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

afterEach(cleanup);

describe.each([
  {
    source: 'PARENT_IOS' as const,
    diagnosticLabel: 'Parent iOS',
    inboxLabel: 'Parent app · iOS',
    platformLabel: 'platform:ios',
  },
  {
    source: 'PARENT_ANDROID' as const,
    diagnosticLabel: 'Parent Android',
    inboxLabel: 'Parent app · Android',
    platformLabel: 'platform:android',
  },
])(
  '$source native component acceptance',
  ({ source, diagnosticLabel, inboxLabel, platformLabel }) => {
    test('submits, reviews, and exercises copy, browser, and oversized export through shared parent components', async () => {
      // Break caught: the native screens work only in isolated mocks, collapse iOS/Android source identity, or reorder public handoff effects.
      const storage = createMemoryAsyncStorage();
      const backend = createNativeFeedbackBackend(source, platformLabel);

      const send = render(
        <ParentFeedbackProvider
          session={session}
          fetch={unusedFetch}
          client={{ createFeedback: backend.client.createFeedback }}
          isOnline
          dependencies={{
            now: () => new Date('2026-08-10T12:00:00.000Z'),
            randomUUID: () => '40000000-0000-4000-8000-000000000001',
            source,
            appVersion: '1.2.3',
            storage,
          }}
        >
          <SendFeedbackScreen />
        </ParentFeedbackProvider>,
      );
      expect(screen.queryByText(/GitHub|public issue|export/i)).toBeNull();
      fireEvent.press(
        screen.getByRole('button', { name: 'Review attached diagnostics' }),
      );
      expect(screen.getByText(`Platform: ${diagnosticLabel}`)).toBeVisible();
      fireEvent.press(screen.getByRole('radio', { name: 'Something broke' }));
      fireEvent.changeText(
        screen.getByLabelText('Tell us more (optional)'),
        'The shared parent feedback control stopped responding.',
      );
      fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
      expect(
        await screen.findByText('Thanks - your feedback was saved.'),
      ).toBeVisible();
      expect(backend.lastSubmission()?.diagnosticSnapshot.source).toBe(source);
      send.unmount();

      const onOpen = jest.fn();
      const inbox = renderWithQuery(
        <FeedbackInboxScreen
          session={session}
          fetch={unusedFetch}
          client={backend.client}
          onOpen={onOpen}
        />,
      );
      expect(await screen.findByText(inboxLabel)).toBeVisible();
      fireEvent.press(
        screen.getByRole('button', { name: 'Open feedback: Something broke' }),
      );
      expect(onOpen).toHaveBeenCalledWith(backend.report().id);
      inbox.unmount();

      expect(await loadMaintainerToolsEnabled(storage)).toBe(false);
      const nonMaintainer = renderWithQuery(
        <FeedbackDetailScreen
          feedbackId={backend.report().id}
          session={session}
          fetch={unusedFetch}
          client={backend.client}
          maintainerToolsEnabled={false}
          randomUUID={() => '50000000-0000-4000-8000-000000000001'}
        />,
      );
      expect(await screen.findByText(inboxLabel)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Prepare public issue' }),
      ).toBeNull();
      fireEvent.changeText(
        screen.getByLabelText('Feedback title'),
        'Reviewed native feedback',
      );
      fireEvent.changeText(
        screen.getByLabelText('Feedback description'),
        'Private details removed by a parent.',
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Remove all diagnostics' }),
      );
      fireEvent.press(screen.getByRole('radio', { name: 'Ready' }));
      fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText('Changes saved.')).toBeVisible();
      expect(backend.report()).toMatchObject({
        source,
        status: 'READY',
        title: 'Reviewed native feedback',
        description: 'Private details removed by a parent.',
        diagnosticSnapshot: { source, events: [] },
      });
      nonMaintainer.unmount();

      await setMaintainerToolsEnabled(storage, true);
      expect(await loadMaintainerToolsEnabled(storage)).toBe(true);
      const onPreparePublicIssue = jest.fn();
      const maintainer = renderWithQuery(
        <FeedbackDetailScreen
          feedbackId={backend.report().id}
          session={session}
          fetch={unusedFetch}
          client={backend.client}
          maintainerToolsEnabled
          onPreparePublicIssue={onPreparePublicIssue}
        />,
      );
      fireEvent.press(
        await screen.findByRole('button', { name: 'Prepare public issue' }),
      );
      expect(onPreparePublicIssue).toHaveBeenCalledWith(backend.report().id);
      maintainer.unmount();

      const copyOrder: string[] = [];
      const copy = renderExport({
        backend,
        clipboard: {
          setStringAsync: async (markdown) => {
            copyOrder.push(`copy:${markdown}`);
          },
        },
        linking: { openURL: jest.fn() },
        onMark: () => copyOrder.push('mark'),
        idempotencyKey: '60000000-0000-4000-8000-000000000001',
      });
      fireEvent.press(
        await screen.findByRole('button', { name: 'Prepare preview' }),
      );
      const exactPreview = backend.preview();
      expect(await screen.findByText(exactPreview.body)).toBeVisible();
      expect(screen.getAllByText(exactPreview.title)).not.toHaveLength(0);
      fireEvent.press(
        screen.getByRole('button', { name: 'Copy validated Markdown' }),
      );
      await waitFor(() => expect(backend.report().status).toBe('EXPORTED'));
      expect(copyOrder).toEqual([
        `copy:${exactPreview.title}\n\n${exactPreview.body}`,
        'mark',
      ]);
      expect(screen.queryByText(/published/i)).toBeNull();
      copy.unmount();

      backend.resetReady();
      const browserOrder: string[] = [];
      const openURL = jest.fn(async (url: string) => {
        browserOrder.push(`open:${url}`);
      });
      const browser = renderExport({
        backend,
        clipboard: { setStringAsync: jest.fn() },
        linking: { openURL },
        onMark: () => browserOrder.push('mark'),
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
      });
      fireEvent.press(
        await screen.findByRole('button', { name: 'Prepare preview' }),
      );
      await screen.findByText(exactPreview.body);
      fireEvent.press(
        screen.getByRole('button', { name: 'Continue to GitHub' }),
      );
      await waitFor(() => expect(backend.report().status).toBe('EXPORTED'));
      const openedUrl = openURL.mock.calls[0]?.[0] ?? '';
      expect(browserOrder.map((entry) => entry.split(':')[0])).toEqual([
        'open',
        'mark',
      ]);
      expect(new URL(openedUrl).searchParams.get('body')).toBe(
        exactPreview.body,
      );
      expect(openedUrl).not.toContain(session.accessToken);
      expect(screen.queryByText(/published/i)).toBeNull();
      browser.unmount();

      backend.resetReady();
      backend.useOversizedPreview();
      const oversizedOrder: string[] = [];
      const oversizedClipboard = jest.fn(async () => {
        oversizedOrder.push('copy');
      });
      const oversizedLinking = jest.fn(async (url: string) => {
        oversizedOrder.push(`open:${url}`);
      });
      renderExport({
        backend,
        clipboard: { setStringAsync: oversizedClipboard },
        linking: { openURL: oversizedLinking },
        onMark: () => oversizedOrder.push('mark'),
        idempotencyKey: '60000000-0000-4000-8000-000000000003',
      });
      fireEvent.press(
        await screen.findByRole('button', { name: 'Prepare preview' }),
      );
      await screen.findByText(backend.preview().body);
      fireEvent.press(
        screen.getByRole('button', { name: 'Continue to GitHub' }),
      );
      await waitFor(() => expect(backend.report().status).toBe('EXPORTED'));
      expect(oversizedOrder.map((entry) => entry.split(':')[0])).toEqual([
        'copy',
        'open',
        'mark',
      ]);
      expect(oversizedClipboard).toHaveBeenCalledWith(
        `${backend.preview().title}\n\n${backend.preview().body}`,
      );
      expect(oversizedLinking).toHaveBeenCalledWith(
        'https://github.com/family/app/issues/new',
      );
      expect(JSON.stringify(backend.calls())).not.toContain(
        session.accessToken,
      );
      expect(screen.queryByText(/published/i)).toBeNull();
    });
  },
);

function renderExport({
  backend,
  clipboard,
  linking,
  onMark,
  idempotencyKey,
}: {
  backend: NativeFeedbackBackend;
  clipboard: { setStringAsync(value: string): Promise<unknown> };
  linking: { openURL(url: string): Promise<unknown> };
  onMark(): void;
  idempotencyKey: string;
}) {
  backend.onNextExportMark(onMark);
  return renderWithQuery(
    <FeedbackExportScreen
      feedbackId={backend.report().id}
      session={session}
      fetch={unusedFetch}
      client={backend.client}
      maintainerToolsEnabled
      linking={linking}
      clipboard={clipboard}
      randomUUID={() => idempotencyKey}
    />,
  );
}

type NativeFeedbackBackend = ReturnType<typeof createNativeFeedbackBackend>;

function createNativeFeedbackBackend(
  source: Extract<FeedbackSource, 'PARENT_IOS' | 'PARENT_ANDROID'>,
  platformLabel: string,
) {
  let currentReport: FeedbackReport | undefined;
  let currentPreview = previewFor(source, platformLabel, false);
  let revision = 0;
  let lastCommand: CreateFeedbackCommand | undefined;
  let nextExportMark: () => void = () => undefined;
  const observedCalls: unknown[] = [];
  const replays = new Map<string, FeedbackReport>();

  const client: Pick<
    FamilyApiClient,
    | 'createFeedback'
    | 'listFeedback'
    | 'getFeedback'
    | 'updateFeedback'
    | 'deleteFeedback'
    | 'prepareFeedbackPublicPreview'
  > = {
    createFeedback: jest.fn(async (command) => {
      observedCalls.push(command);
      lastCommand = command;
      currentReport = FeedbackReportSchema.parse({
        id: '30000000-0000-4000-8000-000000000001',
        category: command.category,
        source: command.diagnosticSnapshot.source,
        appVersion: command.diagnosticSnapshot.appVersion,
        screen: command.diagnosticSnapshot.currentScreen,
        status: 'NEW',
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
        title: 'Something broke',
        description: command.description,
        diagnosticSnapshot: command.diagnosticSnapshot,
        privacyFindings: [],
        publicIssueUrl: null,
        reviewedAt: null,
        exportedAt: null,
        closedAt: null,
      });
      return {
        id: currentReport.id,
        status: currentReport.status,
        createdAt: currentReport.createdAt,
      };
    }),
    listFeedback: jest.fn(async () => [listItem(requireReport())]),
    getFeedback: jest.fn(async () => requireReport()),
    updateFeedback: jest.fn(
      async (_feedbackId: string, command: UpdateFeedbackCommand) => {
        observedCalls.push(command);
        const replay = replays.get(command.idempotencyKey);
        if (replay) return replay;
        const report = requireReport();
        if (command.expectedUpdatedAt !== report.updatedAt) {
          throw new Error('acceptance harness CAS conflict');
        }
        if (command.status === 'EXPORTED') nextExportMark();
        revision += 1;
        currentReport = FeedbackReportSchema.parse({
          ...report,
          title: command.title ?? report.title,
          description: command.description ?? report.description,
          status: command.status ?? report.status,
          publicIssueUrl:
            command.publicIssueUrl === undefined
              ? report.publicIssueUrl
              : command.publicIssueUrl,
          diagnosticSnapshot: {
            ...report.diagnosticSnapshot,
            events:
              command.diagnosticEvents ?? report.diagnosticSnapshot.events,
          },
          privacyFindings: [],
          reviewedAt: '2026-08-10T13:00:00.000Z',
          exportedAt:
            command.status === 'EXPORTED'
              ? '2026-08-10T14:00:00.000Z'
              : report.exportedAt,
          updatedAt: `2026-08-10T13:00:${String(revision).padStart(2, '0')}.000Z`,
        });
        replays.set(command.idempotencyKey, currentReport);
        return currentReport;
      },
    ),
    deleteFeedback: jest.fn(async () => ({
      id: requireReport().id,
      deleted: true as const,
    })),
    prepareFeedbackPublicPreview: jest.fn(async () => currentPreview),
  };

  function requireReport(): FeedbackReport {
    if (!currentReport) throw new Error('Submit feedback before review.');
    return currentReport;
  }

  return {
    client,
    report: requireReport,
    preview: () => currentPreview,
    lastSubmission: () => lastCommand,
    calls: () => observedCalls,
    onNextExportMark(callback: () => void) {
      nextExportMark = callback;
    },
    resetReady() {
      const report = requireReport();
      revision += 1;
      currentReport = FeedbackReportSchema.parse({
        ...report,
        status: 'READY',
        exportedAt: null,
        updatedAt: `2026-08-10T13:00:${String(revision).padStart(2, '0')}.000Z`,
      });
    },
    useOversizedPreview() {
      currentPreview = previewFor(source, platformLabel, true);
    },
  };
}

function listItem(report: FeedbackReport): FeedbackListItem {
  return {
    id: report.id,
    category: report.category,
    source: report.source,
    appVersion: report.appVersion,
    screen: report.screen,
    status: report.status,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    descriptionPreview: report.description.slice(0, 80),
    hasDiagnostics: report.diagnosticSnapshot.events.length > 0,
  };
}

function previewFor(
  source: Extract<FeedbackSource, 'PARENT_IOS' | 'PARENT_ANDROID'>,
  platformLabel: string,
  oversized: boolean,
): FeedbackPublicPreview {
  return FeedbackPublicPreviewSchema.parse({
    repositoryUrl: 'https://github.com/family/app',
    title: `Server validated ${source.toLowerCase()} feedback`,
    body: oversized
      ? `## Exact server preview\n\n${'✓'.repeat(5_000)}`
      : `## Exact server preview\n\nSanitized ${source.toLowerCase()} description.`,
    labels: ['feedback', 'app:parent', platformLabel, 'type:bug'],
    redactions: [],
  });
}

function renderWithQuery(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
  const view = render(element, { wrapper: queryWrapper(queryClient) });
  const unmount = () => {
    view.unmount();
    queryClient.clear();
  };
  return { ...view, unmount };
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
