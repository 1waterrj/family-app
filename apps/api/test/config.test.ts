import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';

const baseEnvironment = {
  DATABASE_URL: 'postgres://family:family@127.0.0.1:5432/family',
  NODE_ENV: 'test',
  DEVELOPMENT_AUTH_SECRET:
    'test-only-development-auth-secret-with-at-least-32-characters',
} as const;

describe('feedback repository configuration', () => {
  it('disables public preview when the repository slug is absent', () => {
    // Break caught: an absent repository silently defaults to a public destination.
    expect(
      readConfig(baseEnvironment).feedbackGithubRepository,
    ).toBeUndefined();
  });

  it('normalizes an exact owner/repository slug to an HTTPS GitHub URL', () => {
    // Break caught: accepted configuration does not produce the exact safe repository origin/path.
    expect(
      readConfig({
        ...baseEnvironment,
        FAMILY_FEEDBACK_GITHUB_REPOSITORY: 'family-tests/family-app',
      }).feedbackGithubRepository,
    ).toBe('https://github.com/family-tests/family-app');
  });

  it.each([
    'https://github.com/family-tests/family-app',
    'http://github.com/family-tests/family-app',
    'family-tests/family-app/extra',
    ' family-tests/family-app',
    'family-tests/family-app ',
    'family tests/family-app',
    'family-tests/family-app.git',
    'family-tests/family-app?tab=readme',
    'family-tests/family-app#readme',
    'token@family-tests/family-app',
    'family-tests/family-app:443',
    'family-tests',
    '',
  ])('fails closed for unsafe repository value %j', (value) => {
    // Break caught: startup accepts syntax that can carry credentials or redirect issue export.
    expect(() =>
      readConfig({
        ...baseEnvironment,
        FAMILY_FEEDBACK_GITHUB_REPOSITORY: value,
      }),
    ).toThrow(/FAMILY_FEEDBACK_GITHUB_REPOSITORY|invalid string/i);
  });
});
