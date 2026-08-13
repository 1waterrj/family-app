import { describe, expect, it } from 'vitest';

import { parseDevelopmentCredential } from '../src/development-credential.js';

const validParentToken =
  'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0.signature';

describe('development credential parser', () => {
  it('returns explicitly untrusted cache metadata from a development fixture token', () => {
    const parsed = parseDevelopmentCredential({
      version: 1,
      apiOrigin: 'http://127.0.0.1:3000',
      accessToken:
        'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0.signature',
    });

    expect(parsed).toEqual({
      session: {
        apiOrigin: 'http://127.0.0.1:3000',
        accessToken:
          'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0.signature',
        actorId: '11111111-1111-4111-8111-111111111111',
        householdId: '22222222-2222-4222-8222-222222222222',
        role: 'PARENT',
      },
      trust: 'UNTRUSTED_DEVELOPMENT_FIXTURE',
    });
  });

  it.each([
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['http://192.168.20.15:3000', 'http://192.168.20.15:3000'],
    ['https://family-api.local:8443', 'https://family-api.local:8443'],
    ['HTTP://LOCALHOST:80/', 'http://localhost'],
    ['http://10.42.0.9/', 'http://10.42.0.9'],
    ['http://172.31.255.254:3000/', 'http://172.31.255.254:3000'],
    ['http://169.254.10.20/', 'http://169.254.10.20'],
    ['http://[::1]:5173/', 'http://[::1]:5173'],
    ['http://[fd12:3456::1]/', 'http://[fd12:3456::1]'],
    ['http://[fe80::1]/', 'http://[fe80::1]'],
  ])(
    'accepts and normalizes a local API origin: %s',
    (apiOrigin, normalized) => {
      // Break caught: generated phone/dashboard credentials being rejected or
      // retaining spelling differences that split otherwise identical sessions.
      const parsed = parseDevelopmentCredential({
        version: 1,
        apiOrigin,
        accessToken: validParentToken,
      });

      expect(parsed).toMatchObject({
        session: { apiOrigin: normalized },
        trust: 'UNTRUSTED_DEVELOPMENT_FIXTURE',
      });
    },
  );

  it.each([
    ['unsupported protocol', 'ftp://127.0.0.1:3000'],
    ['username', 'http://fixture@127.0.0.1:3000'],
    ['password', 'http://fixture:secret@127.0.0.1:3000'],
    ['non-root path', 'http://127.0.0.1:3000/v1'],
    ['query', 'http://127.0.0.1:3000/?actor=parent'],
    ['fragment', 'http://127.0.0.1:3000/#token'],
    ['public IPv4 address', 'https://8.8.8.8'],
    ['public IPv6 address', 'https://[2001:4860:4860::8888]'],
    ['public DNS hostname', 'https://example.com'],
    ['malformed IPv4 octet', 'http://192.168.1.999'],
    ['non-decimal IPv4 octet', 'http://0177.0.0.1'],
    ['deceptive localhost suffix', 'http://localhost.evil'],
    ['deceptive local suffix', 'http://family.local.evil'],
    ['invalid local hostname label', 'http://-family.local'],
    ['escaped local hostname', 'http://%66amily.local'],
    ['backslash IPv6 authority', String.raw`http:\\[::1]`],
    ['trailing IPv6 backslash', 'http://[::1]\\'],
    ['IPv6 authority whitespace', 'http://[\t::1]\n'],
    ['bare local suffix', 'http://local'],
  ])('rejects a non-local API origin with %s', (_category, apiOrigin) => {
    // Break caught: credentials authorizing accidental or deceptive remote
    // origins, or URLs whose extra components alter request routing.
    expect(
      parseDevelopmentCredential({
        version: 1,
        apiOrigin,
        accessToken: validParentToken,
      }),
    ).toBeNull();
  });

  it('rejects unrecognized credentials and untrusted claims without a valid session', () => {
    expect(
      parseDevelopmentCredential({
        version: 2,
        apiOrigin: 'http://127.0.0.1:3000',
        accessToken: 'claims.signature',
      }),
    ).toBeNull();
    expect(
      parseDevelopmentCredential({
        version: 1,
        apiOrigin: 'http://localhost:3000',
        accessToken: 'claims.signature',
      }),
    ).toBeNull();
    expect(
      parseDevelopmentCredential({
        version: 1,
        apiOrigin: 'http://127.0.0.1:3000',
        accessToken: 'eyJyb2xlIjoiU1lTVEVNIn0.signature',
      }),
    ).toBeNull();
  });

  it.each([
    'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0',
    'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0.',
    'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0.signature.extra',
    'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0=.signature',
    'eyJhY3RvcklkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaG91c2Vob2xkSWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJyb2xlIjoiUEFSRU5UIn0 .signature',
  ])(
    'rejects token syntax the development server cannot authenticate: %s',
    (accessToken) => {
      expect(
        parseDevelopmentCredential({
          version: 1,
          apiOrigin: 'http://127.0.0.1:3000',
          accessToken,
        }),
      ).toBeNull();
    },
  );
});
