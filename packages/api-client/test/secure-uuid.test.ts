import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createSecureUuid } from '../src/secure-uuid.js';

describe('secure UUID generation', () => {
  it('uses getRandomValues when randomUUID is unavailable and returns RFC 4122 UUID v4', () => {
    // Break caught: a plain-LAN browser without crypto.randomUUID cannot create durable operations.
    const getRandomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>) => {
      bytes.set([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x06, 0x77, 0xc8, 0x99, 0xaa, 0xbb,
        0xcc, 0xdd, 0xee, 0xff,
      ]);
      return bytes;
    });

    const uuid = createSecureUuid({ getRandomValues });

    expect(uuid).toBe('00112233-4455-4677-8899-aabbccddeeff');
    expect(z.uuid().safeParse(uuid).success).toBe(true);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the runtime has no secure random source', () => {
    // Break caught: an unavailable Web Crypto surface silently falls back to predictable randomness.
    expect(() => createSecureUuid({})).toThrow(
      'Secure UUID generation requires crypto.randomUUID or crypto.getRandomValues.',
    );
  });
});
