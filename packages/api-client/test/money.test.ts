import { describe, expect, it } from 'vitest';

import {
  formatCents,
  parseSignedDollars,
  parseUnsignedDollars,
} from '../src/index.js';

describe('money helpers', () => {
  it('parses decimal dollars into exact integer cents', () => {
    expect(parseUnsignedDollars('0')).toBe(0);
    expect(parseUnsignedDollars('0.5')).toBe(50);
    expect(parseUnsignedDollars('12.34')).toBe(1234);
    expect(parseSignedDollars('+12.34')).toBe(1234);
    expect(parseSignedDollars('-12.34')).toBe(-1234);
  });

  it('rejects non-decimal input and PostgreSQL int4 overflow', () => {
    expect(() => parseUnsignedDollars('1.005')).toThrow();
    expect(() => parseUnsignedDollars('1,000')).toThrow();
    expect(() => parseUnsignedDollars('1e2')).toThrow();
    expect(() => parseUnsignedDollars('21474836.48')).toThrow();
    expect(() => parseSignedDollars('-21474836.49')).toThrow();
  });

  it('formats negative integer cents using the requested locale', () => {
    expect(formatCents(-1234, 'en-US')).toBe('-$12.34');
  });
});
