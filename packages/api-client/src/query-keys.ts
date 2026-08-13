import type { ClientSession } from './client.js';

type CacheScope = readonly [
  'family',
  string,
  string,
  string,
  ClientSession['role'],
];

function scope(session: ClientSession): CacheScope {
  return [
    'family',
    session.apiOrigin,
    session.householdId,
    session.actorId,
    session.role,
  ];
}

export const familyQueryKeys = {
  parentSnapshot: (session: ClientSession) =>
    [...scope(session), 'parent-snapshot'] as const,
  dashboardSnapshot: (session: ClientSession) =>
    [...scope(session), 'dashboard-snapshot'] as const,
  ledger: (session: ClientSession, childId: string) =>
    [...scope(session), 'ledger', childId] as const,
  feedbackList: (session: ClientSession) =>
    [...scope(session), 'feedback-list'] as const,
  feedbackDetail: (session: ClientSession, feedbackId: string) =>
    [...scope(session), 'feedback-detail', feedbackId] as const,
};
