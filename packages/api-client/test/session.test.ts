import { describe, expect, it } from 'vitest';

import { parsePersistedClientSession } from '../src/index.js';

const parentSession = {
  apiOrigin: 'HTTP://LOCALHOST:80/',
  accessToken: 'opaque-token',
  actorId: '11111111-1111-4111-8111-111111111111',
  householdId: '22222222-2222-4222-8222-222222222222',
  role: 'PARENT',
};

describe('persisted client session parser', () => {
  it('normalizes an approved local origin and requires the caller role', () => {
    expect(parsePersistedClientSession(parentSession, 'PARENT')).toEqual({
      ...parentSession,
      apiOrigin: 'http://localhost',
    });
    expect(parsePersistedClientSession(parentSession, 'DASHBOARD')).toBeNull();
  });

  it.each([
    ['public origin', { apiOrigin: 'https://family.example.test' }],
    ['deceptive origin', { apiOrigin: 'http://localhost.example.com' }],
    ['malformed actor id', { actorId: 'not-a-uuid' }],
    ['malformed household id', { householdId: 'not-a-uuid' }],
    ['empty token', { accessToken: '' }],
    ['unknown metadata', { unexpected: true }],
  ])('rejects %s', (_case, override) => {
    expect(
      parsePersistedClientSession({ ...parentSession, ...override }, 'PARENT'),
    ).toBeNull();
  });
});
