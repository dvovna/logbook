import {
  currentWeekStart,
  PeriodPreset,
  presetPeriod,
  shiftDay,
  weekDays,
  weekStartOf,
} from '@common/utils/period-presets';

describe('presetPeriod', () => {
  // A Wednesday.
  const today = new Date('2026-06-17T15:30:00Z');

  it.each([
    [PeriodPreset.ThisWeek, '2026-06-15', '2026-06-17'],
    [PeriodPreset.LastWeek, '2026-06-08', '2026-06-14'],
    [PeriodPreset.ThisMonth, '2026-06-01', '2026-06-17'],
    [PeriodPreset.LastMonth, '2026-05-01', '2026-05-31'],
    [PeriodPreset.ThisQuarter, '2026-04-01', '2026-06-17'],
    [PeriodPreset.LastQuarter, '2026-01-01', '2026-03-31'],
  ])('gives %s as %s to %s', (preset, fromDate, toDate) => {
    expect(presetPeriod(preset, today)).toEqual({ fromDate, toDate });
  });

  it('starts the week on Monday, a Sunday included', () => {
    expect(
      presetPeriod(PeriodPreset.ThisWeek, new Date('2026-06-21T23:00:00Z')),
    ).toEqual({ fromDate: '2026-06-15', toDate: '2026-06-21' });
    expect(
      presetPeriod(PeriodPreset.LastWeek, new Date('2026-06-15T00:00:00Z')),
    ).toEqual({ fromDate: '2026-06-08', toDate: '2026-06-14' });
  });

  it('crosses into the previous year', () => {
    const january = new Date('2027-01-06T10:00:00Z');

    expect(presetPeriod(PeriodPreset.LastMonth, january)).toEqual({
      fromDate: '2026-12-01',
      toDate: '2026-12-31',
    });
    expect(presetPeriod(PeriodPreset.LastQuarter, january)).toEqual({
      fromDate: '2026-10-01',
      toDate: '2026-12-31',
    });
    expect(presetPeriod(PeriodPreset.LastWeek, january)).toEqual({
      fromDate: '2026-12-28',
      toDate: '2027-01-03',
    });
  });

  it('gives all time no dates', () => {
    expect(presetPeriod(PeriodPreset.AllTime, today)).toBeNull();
  });
});

describe('currentWeekStart', () => {
  it.each([
    ['2026-06-17T12:00:00Z', '2026-06-15'],
    ['2026-06-15T00:00:00Z', '2026-06-15'],
    ['2026-06-21T23:59:00Z', '2026-06-15'],
    ['2026-06-22T00:00:00Z', '2026-06-22'],
  ])('puts %s in the week of %s', (now, monday) => {
    expect(currentWeekStart(new Date(now))).toBe(monday);
  });
});

describe('weeks', () => {
  it('starts a week on Monday', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekStartOf('2026-12-28')).toBe('2026-12-28');
    expect(weekStartOf('2027-01-03')).toBe('2026-12-28');
  });

  it('lists the seven days', () => {
    const days = weekDays('2026-12-28');

    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-12-28');
    expect(days[6]).toBe('2027-01-03');
  });
});

describe('shiftDay', () => {
  it('moves a date by whole days, across months and years', () => {
    expect(shiftDay('2026-06-18', -1)).toBe('2026-06-17');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});
