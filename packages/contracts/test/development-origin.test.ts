import { describe, expect, it } from 'vitest';

import { normalizeLocalDevelopmentOrigin } from '../src/development-origin.js';

describe('local development origin normalization', () => {
  it.each([
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['http://192.168.20.15:3000/', 'http://192.168.20.15:3000'],
    ['https://family-api.local:8443', 'https://family-api.local:8443'],
    ['HTTP://LOCALHOST:80/', 'http://localhost'],
    ['http://[::1]:5173/', 'http://[::1]:5173'],
    ['http://[fd12:3456::1]', 'http://[fd12:3456::1]'],
    ['http://[fe80::1]', 'http://[fe80::1]'],
  ])('normalizes an allowed origin: %s', (value, expected) => {
    // Break caught: either server or client rejecting a generated local origin
    // or retaining an equivalent spelling as a distinct session boundary.
    expect(normalizeLocalDevelopmentOrigin(value)).toBe(expected);
  });

  it.each([
    ['public hostname', 'https://example.com'],
    ['public IPv4', 'https://8.8.8.8'],
    ['public IPv6', 'https://[2001:4860:4860::8888]'],
    ['credentials', 'http://fixture:secret@127.0.0.1:3000'],
    ['path', 'http://127.0.0.1:3000/v1'],
    ['query', 'http://127.0.0.1:3000/?role=parent'],
    ['fragment', 'http://127.0.0.1:3000/#token'],
    ['malformed IPv4', 'http://192.168.1.999'],
    ['non-decimal IPv4', 'http://0177.0.0.1'],
    ['deceptive suffix', 'http://localhost.evil'],
    ['escaped DNS host', 'http://%66amily.local'],
    ['backslash authority', String.raw`http:\\[::1]`],
    ['trailing backslash', 'http://[::1]\\'],
    ['tab in IPv6', 'http://[\t::1]'],
    ['newline after IPv6', 'http://[::1]\n'],
    ['non-numeric port', 'http://[::1]:dev'],
    ['out-of-range port', 'http://[::1]:65536'],
  ])('rejects %s before URL normalization can broaden it', (_case, value) => {
    // Break caught: WHATWG URL repair turning malformed or remote input into an
    // accepted credential/server origin.
    expect(normalizeLocalDevelopmentOrigin(value)).toBeNull();
  });
});
