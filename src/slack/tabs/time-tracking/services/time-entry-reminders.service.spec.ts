import {
  mondayOf,
  weeksOf,
} from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';

describe('mondayOf', () => {
  it.each([
    ['2026-06-17T12:00:00Z', '2026-06-15'],
    ['2026-06-15T00:00:00Z', '2026-06-15'],
    ['2026-06-21T23:59:00Z', '2026-06-15'],
    ['2026-06-22T00:00:00Z', '2026-06-22'],
  ])('puts %s in the week of %s', (now, monday) => {
    expect(mondayOf(new Date(now))).toBe(monday);
  });
});

describe('weeksOf', () => {
  it('names the week of entries in one week', () => {
    expect(
      weeksOf([{ work_date: '2026-06-11' }, { work_date: '2026-06-08' }]),
    ).toBe('week of 8 Jun');
  });

  it('names the oldest week of entries in several', () => {
    expect(
      weeksOf([{ work_date: '2026-06-11' }, { work_date: '2026-06-03' }]),
    ).toBe('from the week of 1 Jun');
  });
});
