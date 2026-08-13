import { describe, expect, it } from 'vitest';

import { familyQueryKeys } from '../src/index.js';

const session = {
  apiOrigin: 'https://api.fixture.test',
  accessToken: 'claims.signature',
  actorId: '11111111-1111-4111-8111-111111111111',
  householdId: '22222222-2222-4222-8222-222222222222',
  role: 'PARENT' as const,
};

describe('family query keys', () => {
  it('partitions parent snapshots by origin, household, actor, and role', () => {
    expect(familyQueryKeys.parentSnapshot(session)).toEqual([
      'family',
      'https://api.fixture.test',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'PARENT',
      'parent-snapshot',
    ]);
  });

  it('partitions child ledgers in the same actor-safe cache scope', () => {
    expect(
      familyQueryKeys.ledger(session, '33333333-3333-4333-8333-333333333333'),
    ).toEqual([
      'family',
      'https://api.fixture.test',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'PARENT',
      'ledger',
      '33333333-3333-4333-8333-333333333333',
    ]);
  });

  it('partitions feedback lists in the same actor-safe cache scope', () => {
    expect(familyQueryKeys.feedbackList(session)).toEqual([
      'family',
      'https://api.fixture.test',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'PARENT',
      'feedback-list',
    ]);
  });

  it('partitions feedback details by feedback ID within the actor-safe scope', () => {
    expect(
      familyQueryKeys.feedbackDetail(
        session,
        '33333333-3333-4333-8333-333333333333',
      ),
    ).toEqual([
      'family',
      'https://api.fixture.test',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'PARENT',
      'feedback-detail',
      '33333333-3333-4333-8333-333333333333',
    ]);
  });
});
