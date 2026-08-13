import type { ClientSession } from '@family/api-client';
import {
  ChoreDecisionResultSchema,
  ParentSnapshotSchema,
  type ChoreDecisionResult,
  type ParentSnapshot,
} from '@family/contracts';

export const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

export const primaryChildId = '30000000-0000-4000-8000-000000000001';
export const secondaryChildId = '30000000-0000-4000-8000-000000000002';
export const oldAttemptId = '60000000-0000-4000-8000-000000000001';
export const newAttemptId = '60000000-0000-4000-8000-000000000002';

export function approvalSnapshot(): ParentSnapshot {
  return ParentSnapshotSchema.parse({
    household: {
      id: parentSession.householdId,
      name: 'Example Family',
      timeZone: 'America/New_York',
      createdAt: '2026-08-01T12:00:00.000Z',
    },
    serverTime: '2026-08-10T12:30:00.000Z',
    children: [
      {
        profile: {
          id: primaryChildId,
          householdId: parentSession.householdId,
          name: 'Avery',
          color: '#7B61A8',
          imageUrl: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
        balanceCents: 850,
      },
      {
        profile: {
          id: secondaryChildId,
          householdId: parentSession.householdId,
          name: 'Riley',
          color: '#197C83',
          imageUrl: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
        balanceCents: 325,
      },
    ],
    templates: [],
    chores: [
      chore({
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        childId: primaryChildId,
        valueCents: 200,
        submittedAt: '2026-08-10T12:10:00.000Z',
      }),
      chore({
        id: '40000000-0000-4000-8000-000000000002',
        name: 'Dishes',
        imageKey: 'dishes',
        childId: secondaryChildId,
        valueCents: 150,
        submittedAt: '2026-08-10T12:20:00.000Z',
      }),
    ],
    pendingApprovals: [
      {
        submissionAttemptId: newAttemptId,
        child: {
          id: secondaryChildId,
          householdId: parentSession.householdId,
          name: 'Riley',
          color: '#197C83',
          imageUrl: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
        chore: chore({
          id: '40000000-0000-4000-8000-000000000002',
          name: 'Dishes',
          imageKey: 'dishes',
          childId: secondaryChildId,
          valueCents: 150,
          submittedAt: '2026-08-10T12:20:00.000Z',
        }),
        claimedAt: null,
        submittedAt: '2026-08-10T12:20:00.000Z',
      },
      {
        submissionAttemptId: oldAttemptId,
        child: {
          id: primaryChildId,
          householdId: parentSession.householdId,
          name: 'Avery',
          color: '#7B61A8',
          imageUrl: null,
          createdAt: '2026-08-01T12:00:00.000Z',
        },
        chore: chore({
          id: '40000000-0000-4000-8000-000000000001',
          name: 'Tidy toys',
          imageKey: 'tidy-toys',
          childId: primaryChildId,
          valueCents: 200,
          submittedAt: '2026-08-10T12:10:00.000Z',
        }),
        claimedAt: '2026-08-10T12:00:00.000Z',
        submittedAt: '2026-08-10T12:10:00.000Z',
      },
    ],
  });
}

export function decisionResult(
  decision: 'APPROVED' | 'REJECTED',
  overrides: { payoutCents?: number | null; note?: string | null } = {},
): ChoreDecisionResult {
  const snapshot = approvalSnapshot();
  const pending = snapshot.pendingApprovals[1]!;
  return ChoreDecisionResultSchema.parse({
    decisionId: '70000000-0000-4000-8000-000000000001',
    submissionAttemptId: oldAttemptId,
    decision,
    payoutCents:
      overrides.payoutCents ?? (decision === 'APPROVED' ? 275 : null),
    note: overrides.note ?? null,
    choreInstance: {
      ...pending.chore,
      status:
        decision === 'APPROVED'
          ? 'APPROVED'
          : pending.chore.status === 'AWAITING_APPROVAL'
            ? 'CLOSED'
            : pending.chore.status,
    },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function chore(input: {
  id: string;
  name: string;
  imageKey: 'tidy-toys' | 'dishes';
  childId: string;
  valueCents: number;
  submittedAt: string;
}) {
  return {
    id: input.id,
    householdId: parentSession.householdId,
    choreTemplateId:
      input.imageKey === 'tidy-toys'
        ? '50000000-0000-4000-8000-000000000001'
        : '50000000-0000-4000-8000-000000000002',
    name: input.name,
    imageKey: input.imageKey,
    imageUrl: null,
    instructions: `Finish ${input.name.toLowerCase()}.`,
    valueCents: input.valueCents,
    durationMinutes: 20,
    status: 'AWAITING_APPROVAL' as const,
    claimedChildId: input.childId,
    claimDeadlineAt: '2026-08-10T12:30:00.000Z',
    submittedAt: input.submittedAt,
    createdAt: '2026-08-10T11:55:00.000Z',
  };
}
