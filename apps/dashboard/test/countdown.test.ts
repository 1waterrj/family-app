import {
  estimateServerOffsetMs,
  remainingSeconds,
} from '../src/features/chores/countdown';

describe('server-authoritative chore countdown', () => {
  test('uses the snapshot server offset and reaches zero exactly at the deadline', () => {
    const noonPlus250 = Date.parse('2026-08-09T12:00:00.250Z');
    const fivePastPlus250 = Date.parse('2026-08-09T12:05:00.250Z');

    expect(
      estimateServerOffsetMs('2026-08-09T12:00:00.000Z', noonPlus250),
    ).toBe(-250);
    expect(
      remainingSeconds('2026-08-09T12:05:00.000Z', noonPlus250, -250),
    ).toBe(300);
    expect(
      remainingSeconds('2026-08-09T12:05:00.000Z', fivePastPlus250, -250),
    ).toBe(0);
  });

  test('clamps an expired deadline to zero', () => {
    expect(
      remainingSeconds(
        '2026-08-09T12:05:00.000Z',
        Date.parse('2026-08-09T12:06:00.000Z'),
        0,
      ),
    ).toBe(0);
  });
});
