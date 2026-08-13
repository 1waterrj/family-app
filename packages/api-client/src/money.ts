const INT4_MAX = 2_147_483_647;
const INT4_MIN = -2_147_483_648;
const unsignedDollarsPattern = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
const signedDollarsPattern = /^([+-]?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;

export function parseUnsignedDollars(value: string): number {
  const match = unsignedDollarsPattern.exec(value);
  if (!match)
    throw new RangeError('Expected dollars with at most two decimals.');

  return toCents(match[1], match[2], 1);
}

export function parseSignedDollars(value: string): number {
  const match = signedDollarsPattern.exec(value);
  if (!match)
    throw new RangeError('Expected signed dollars with at most two decimals.');

  const sign = match[1] === '-' ? -1 : 1;
  return toCents(match[2], match[3], sign);
}

export function formatCents(cents: number, locale: string): string {
  if (!Number.isSafeInteger(cents) || cents < INT4_MIN || cents > INT4_MAX) {
    throw new RangeError('Cents must be a PostgreSQL int4 value.');
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function toCents(
  wholeDollars: string,
  decimalDollars: string | undefined,
  sign: 1 | -1,
): number {
  const fractionalCents = `${decimalDollars ?? ''}00`.slice(0, 2);
  const magnitude = BigInt(wholeDollars) * 100n + BigInt(fractionalCents);
  const cents = sign === -1 ? -magnitude : magnitude;
  if (cents < BigInt(INT4_MIN) || cents > BigInt(INT4_MAX)) {
    throw new RangeError('Amount exceeds PostgreSQL int4 cents range.');
  }
  return Number(cents);
}
