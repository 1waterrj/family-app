import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { createParentQueryClient } from '../src/query/create-query-client';
import { ChoresScreen } from '../src/screens/chores-screen';
import {
  approvalSnapshot,
  jsonResponse,
  parentSession,
} from './approval-fixtures';

const templateId = '50000000-0000-4000-8000-000000000003';
const choreId = '40000000-0000-4000-8000-000000000003';
const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('parent chore library', () => {
  test('offers every built-in chore picture with an accessible label', async () => {
    renderChores(async () => jsonResponse(choreSnapshot()));

    expect(await screen.findByText('Chore library')).toBeVisible();
    for (const label of [
      'Tidy toys',
      'Dishes',
      'Set the table',
      'Laundry',
      'Feed a pet',
      'Make the bed',
      'Wipe a counter',
      'Help in the garden',
    ]) {
      expect(
        screen.getByRole('button', { name: `Choose ${label} picture` }),
      ).toBeVisible();
    }
  });

  test('creates a pictured template with exact cents and keeps it selected after refreshing', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let snapshotReads = 0;
    const createdTemplate = template({
      id: templateId,
      name: 'Water plants',
      imageKey: 'help-garden',
      instructions: 'Give each plant one cup.',
      defaultValueCents: 275,
      defaultDurationMinutes: 18,
    });
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot') {
        snapshotReads += 1;
        return jsonResponse(
          choreSnapshot(snapshotReads > 1 ? [createdTemplate] : []),
        );
      }
      requests.push({ url: String(url), init });
      return jsonResponse(createdTemplate, 201);
    };
    renderChores(fetchImpl);
    await screen.findByText('Chore library');

    fireEvent.changeText(screen.getByLabelText('Chore name'), ' Water plants ');
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose Help in the garden picture' }),
    );
    fireEvent.changeText(
      screen.getByLabelText('Chore instructions'),
      ' Give each plant one cup. ',
    );
    fireEvent.changeText(screen.getByLabelText('Default reward'), '2.75');
    fireEvent.changeText(screen.getByLabelText('Default duration'), '18');
    fireEvent.press(screen.getByRole('button', { name: 'Create template' }));

    expect(
      await screen.findByText('Water plants is selected for publishing.'),
    ).toBeVisible();
    expect(snapshotReads).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      householdId: parentSession.householdId,
      name: 'Water plants',
      imageKey: 'help-garden',
      instructions: 'Give each plant one cup.',
      defaultValueCents: 275,
      defaultDurationMinutes: 18,
    });
    expect(headerValue(requests[0]?.init?.headers, 'idempotency-key')).toMatch(
      uuidPattern,
    );
  });

  test('freezes an ambiguous template draft until an explicit new operation rotates its key', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const operationKeys: string[] = [];
    let writes = 0;
    let createdTemplate: ReturnType<typeof template> | undefined;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      if (new URL(String(url)).pathname === '/v1/parent/snapshot') {
        return jsonResponse(
          choreSnapshot(createdTemplate ? [createdTemplate] : []),
        );
      }
      writes += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      operationKeys.push(headerValue(init?.headers, 'idempotency-key'));
      if (writes === 1) throw new TypeError('offline');
      createdTemplate = template({
        id: templateId,
        name: String(bodies[1]?.name),
        instructions: String(bodies[1]?.instructions),
      });
      return jsonResponse(createdTemplate, 201);
    };
    renderChores(fetchImpl);
    await screen.findByText('Chore library');
    populateTemplateDraft();
    fireEvent.press(screen.getByRole('button', { name: 'Create template' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(screen.getByLabelText('Chore name')).toHaveProp('editable', false);
    expect(
      screen.getByRole('button', { name: 'Create template' }),
    ).toBeEnabled();

    fireEvent.press(
      screen.getByRole('button', { name: 'Start new template operation' }),
    );
    expect(screen.getByLabelText('Chore name')).toHaveProp('editable', true);
    fireEvent.changeText(screen.getByLabelText('Chore name'), 'Dry dishes');
    fireEvent.press(screen.getByRole('button', { name: 'Create template' }));

    expect(
      await screen.findByText('Dry dishes is selected for publishing.'),
    ).toBeVisible();
    expect(bodies.map(({ name }) => name)).toEqual(['Dishes', 'Dry dishes']);
    expect(operationKeys[1]).not.toBe(operationKeys[0]);
  });

  test.each([
    ['blank name', 'Chore name', '   ', 'Enter a chore name.'],
    [
      'blank instructions',
      'Chore instructions',
      '   ',
      'Enter chore instructions.',
    ],
    [
      'fractional cents',
      'Default reward',
      '2.999',
      'Enter dollars with no more than two decimals.',
    ],
    [
      'duration below one',
      'Default duration',
      '0',
      'Duration must be a whole number from 1 to 1440.',
    ],
    [
      'duration above one day',
      'Default duration',
      '1441',
      'Duration must be a whole number from 1 to 1440.',
    ],
  ] as const)(
    'rejects %s before contacting the server',
    async (_case, label, value, message) => {
      const fetchImpl = jest.fn(async () => jsonResponse(choreSnapshot()));
      renderChores(fetchImpl);
      await screen.findByText('Chore library');
      populateTemplateDraft();
      fireEvent.changeText(screen.getByLabelText(label), value);
      fireEvent.press(screen.getByRole('button', { name: 'Create template' }));

      expect(await screen.findByText(message)).toBeVisible();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  test('publishes defaults when overrides are blank', async () => {
    const requests: RequestInit[] = [];
    const existing = template();
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot') {
        return jsonResponse(choreSnapshot([existing]));
      }
      requests.push(init ?? {});
      return jsonResponse(publishedChore(existing), 201);
    };
    renderChores(fetchImpl);
    await screen.findByText('Chore library');
    fireEvent.press(
      screen.getByRole('button', { name: `Select ${existing.name} template` }),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));

    expect(
      await screen.findByText('Added Dishes to the shared pool.'),
    ).toBeVisible();
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      householdId: parentSession.householdId,
      choreTemplateId: existing.id,
    });
  });

  test('keeps publish overrides and its operation key across an offline retry', async () => {
    const existing = template();
    const bodies: unknown[] = [];
    const operationKeys: string[] = [];
    let publishAttempt = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/parent/snapshot') {
        return jsonResponse(choreSnapshot([existing]));
      }
      bodies.push(JSON.parse(String(init?.body)));
      operationKeys.push(headerValue(init?.headers, 'idempotency-key'));
      publishAttempt += 1;
      if (publishAttempt === 1) throw new TypeError('offline');
      return jsonResponse(
        publishedChore(existing, {
          instructions: 'Use the blue sponge.',
          valueCents: 325,
          durationMinutes: 22,
        }),
        201,
      );
    };
    renderChores(fetchImpl);
    await screen.findByText('Chore library');
    fireEvent.press(
      screen.getByRole('button', { name: `Select ${existing.name} template` }),
    );
    fireEvent.changeText(
      screen.getByLabelText('Published instructions override'),
      'Use the blue sponge.',
    );
    fireEvent.changeText(
      screen.getByLabelText('Published reward override'),
      '3.25',
    );
    fireEvent.changeText(
      screen.getByLabelText('Published duration override'),
      '22',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(screen.getByDisplayValue('Use the blue sponge.')).toBeVisible();
    expect(screen.getByDisplayValue('3.25')).toBeVisible();
    expect(screen.getByDisplayValue('22')).toBeVisible();
    expect(screen.getByLabelText('Published reward override')).toHaveProp(
      'editable',
      false,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));
    expect(
      await screen.findByText('Added Dishes to the shared pool.'),
    ).toBeVisible();
    expect(bodies).toEqual([
      {
        householdId: parentSession.householdId,
        choreTemplateId: existing.id,
        instructions: 'Use the blue sponge.',
        valueCents: 325,
        durationMinutes: 22,
      },
      {
        householdId: parentSession.householdId,
        choreTemplateId: existing.id,
        instructions: 'Use the blue sponge.',
        valueCents: 325,
        durationMinutes: 22,
      },
    ]);
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[1]).toBe(operationKeys[0]);
  });

  test('requires an explicit new publish operation before editing an ambiguous draft', async () => {
    const existing = template();
    const bodies: unknown[] = [];
    const operationKeys: string[] = [];
    let writes = 0;
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
      if (new URL(String(url)).pathname === '/v1/parent/snapshot') {
        return jsonResponse(choreSnapshot([existing]));
      }
      writes += 1;
      bodies.push(JSON.parse(String(init?.body)));
      operationKeys.push(headerValue(init?.headers, 'idempotency-key'));
      if (writes === 1) throw new TypeError('offline');
      return jsonResponse(publishedChore(existing, { valueCents: 400 }), 201);
    };
    renderChores(fetchImpl);
    await screen.findByText('Chore library');
    fireEvent.press(
      screen.getByRole('button', { name: `Select ${existing.name} template` }),
    );
    fireEvent.changeText(
      screen.getByLabelText('Published reward override'),
      '3.25',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    fireEvent.press(
      screen.getByRole('button', { name: 'Start new publish operation' }),
    );
    fireEvent.changeText(
      screen.getByLabelText('Published reward override'),
      '4.00',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));

    expect(
      await screen.findByText('Added Dishes to the shared pool.'),
    ).toBeVisible();
    expect(bodies).toEqual([
      {
        householdId: parentSession.householdId,
        choreTemplateId: existing.id,
        valueCents: 325,
      },
      {
        householdId: parentSession.householdId,
        choreTemplateId: existing.id,
        valueCents: 400,
      },
    ]);
    expect(operationKeys[1]).not.toBe(operationKeys[0]);
  });
});

function renderChores(fetchImpl: typeof globalThis.fetch) {
  const queryClient = createParentQueryClient(parentSession);
  trackedQueryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <ChoresScreen session={parentSession} fetch={fetchImpl} />
    </QueryClientProvider>,
  );
}

function populateTemplateDraft() {
  fireEvent.changeText(screen.getByLabelText('Chore name'), 'Dishes');
  fireEvent.changeText(
    screen.getByLabelText('Chore instructions'),
    'Load the dishwasher.',
  );
  fireEvent.changeText(screen.getByLabelText('Default reward'), '2.50');
  fireEvent.changeText(screen.getByLabelText('Default duration'), '20');
}

function choreSnapshot(templates = [template()]) {
  return { ...approvalSnapshot(), templates, pendingApprovals: [] };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: templateId,
    householdId: parentSession.householdId,
    name: 'Dishes',
    imageKey: 'dishes' as const,
    imageUrl: null,
    instructions: 'Load the dishwasher.',
    defaultValueCents: 250,
    defaultDurationMinutes: 20,
    isActive: true,
    createdAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

function publishedChore(
  source: ReturnType<typeof template>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: choreId,
    householdId: parentSession.householdId,
    choreTemplateId: source.id,
    name: source.name,
    imageKey: source.imageKey,
    imageUrl: source.imageUrl,
    instructions: source.instructions,
    valueCents: source.defaultValueCents,
    durationMinutes: source.defaultDurationMinutes,
    status: 'AVAILABLE' as const,
    claimedChildId: null,
    claimDeadlineAt: null,
    submittedAt: null,
    createdAt: '2026-08-10T12:30:00.000Z',
    ...overrides,
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? '';
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
