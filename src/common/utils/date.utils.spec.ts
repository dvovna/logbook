import { formatDate, formatDateRange } from '@common/utils/date.utils';

describe('formatDate', () => {
  it('writes the day, the short month and the year', () => {
    expect(formatDate('2026-07-06')).toBe('6 Jul 2026');
    expect(formatDate('2026-09-30')).toBe('30 Sep 2026');
  });

  it('takes the UTC date of a timestamp', () => {
    expect(formatDate('2026-11-07T23:30:00Z')).toBe('7 Nov 2026');
    expect(formatDate(new Date('2026-01-01T00:00:00Z'))).toBe('1 Jan 2026');
  });
});

describe('formatDateRange', () => {
  it('names the month once within a month', () => {
    expect(formatDateRange('2026-07-06', '2026-07-10')).toBe('6–10 Jul 2026');
  });

  it('names both months within a year', () => {
    expect(formatDateRange('2026-06-29', '2026-07-03')).toBe(
      '29 Jun – 3 Jul 2026',
    );
  });

  it('names both years across a new year', () => {
    expect(formatDateRange('2026-12-28', '2027-01-02')).toBe(
      '28 Dec 2026 – 2 Jan 2027',
    );
  });

  it('writes one date for a single day', () => {
    expect(formatDateRange('2026-07-06', '2026-07-06')).toBe('6 Jul 2026');
  });
});
