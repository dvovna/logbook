import { weeksOf } from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';

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
