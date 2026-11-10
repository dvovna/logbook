import { mondayOf } from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';

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
