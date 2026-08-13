import type { ClientSession } from '@family/api-client';
import { DashboardSnapshotSchema } from '@family/contracts';

export const dashboardSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:5173',
  accessToken: fixtureToken('DASHBOARD'),
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'DASHBOARD',
};

export const dashboardSnapshot = DashboardSnapshotSchema.parse({
  household: {
    id: dashboardSession.householdId,
    name: 'Example Family',
    timeZone: 'America/New_York',
  },
  serverTime: '2026-08-10T12:00:00.000Z',
  children: [
    {
      profile: {
        id: '30000000-0000-4000-8000-000000000001',
        householdId: dashboardSession.householdId,
        name: 'Avery',
        color: '#7B61A8',
        imageUrl: null,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      balanceCents: 850,
    },
    {
      profile: {
        id: '30000000-0000-4000-8000-000000000002',
        householdId: dashboardSession.householdId,
        name: 'Riley',
        color: '#197C83',
        imageUrl: null,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      balanceCents: 325,
    },
  ],
  chores: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      choreTemplateId: '50000000-0000-4000-8000-000000000001',
      name: 'Make the bed',
      imageKey: 'make-bed',
      imageUrl: null,
      instructions: 'Pull up the covers.',
      valueCents: 150,
      durationMinutes: 15,
      status: 'CLAIMED',
      claimedChildId: '30000000-0000-4000-8000-000000000001',
      claimDeadlineAt: '2026-08-10T12:15:00.000Z',
      submittedAt: null,
      createdAt: '2026-08-10T11:55:00.000Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      choreTemplateId: '50000000-0000-4000-8000-000000000002',
      name: 'Tidy toys',
      imageKey: 'tidy-toys',
      imageUrl: null,
      instructions: 'Put toys in their bins.',
      valueCents: 200,
      durationMinutes: 20,
      status: 'AVAILABLE',
      claimedChildId: null,
      claimDeadlineAt: null,
      submittedAt: null,
      createdAt: '2026-08-10T11:58:00.000Z',
    },
  ],
});

export function credentialJson(role: ClientSession['role']): string {
  return JSON.stringify({
    version: 1,
    apiOrigin: 'http://127.0.0.1:3000',
    accessToken: fixtureToken(role),
  });
}

function fixtureToken(role: ClientSession['role']): string {
  const claims = btoa(
    JSON.stringify({
      actorId: dashboardSessionActor(role),
      householdId: '20000000-0000-4000-8000-000000000001',
      role,
    }),
  )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${claims}.fixture-signature`;
}

function dashboardSessionActor(role: ClientSession['role']): string {
  return role === 'DASHBOARD'
    ? '10000000-0000-4000-8000-000000000001'
    : '10000000-0000-4000-8000-000000000002';
}
