import {
  collectedMonth,
  dueDateOf,
  isLate,
  monthLabel,
  monthOf,
  offeredMonths,
} from '@modules/receipts/utils/receipt-months';

describe('receipt months', () => {
  it('takes the month of a date', () => {
    expect(monthOf('2026-10-17')).toBe('2026-10-01');
  });

  it('puts the due date in the month after', () => {
    expect(dueDateOf('2026-10-01', 4)).toBe('2026-11-04');
    expect(dueDateOf('2026-12-01', 28)).toBe('2027-01-28');
  });

  it('collects the last month up to and on the due day', () => {
    expect(collectedMonth('2026-11-04', 4)).toBe('2026-10-01');
    expect(collectedMonth('2026-11-05', 4)).toBe('2026-11-01');
    expect(collectedMonth('2026-10-31', 4)).toBe('2026-10-01');
  });

  it('offers this month and the two before, newest first', () => {
    expect(offeredMonths('2027-01-15')).toEqual([
      '2027-01-01',
      '2026-12-01',
      '2026-11-01',
    ]);
  });

  it('is late from the day after the due day', () => {
    expect(isLate('2026-11-04T23:59:59.000000+00:00', '2026-10-01', 4)).toBe(
      false,
    );
    expect(isLate('2026-11-05T00:00:00.000000+00:00', '2026-10-01', 4)).toBe(
      true,
    );
  });

  it('labels a month', () => {
    expect(monthLabel('2026-10-01')).toBe('October 2026');
  });
});
