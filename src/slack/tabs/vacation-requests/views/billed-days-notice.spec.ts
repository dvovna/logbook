import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';

describe('withBilledDays', () => {
  const NOTICE = '✅ Vacation request updated.';

  it('leaves the notice as it is without billed days', () => {
    expect(withBilledDays(NOTICE, [])).toBe(NOTICE);
  });

  it('names one day', () => {
    expect(withBilledDays(NOTICE, ['2026-06-17'])).toBe(
      `${NOTICE} 1 day stays logged: it is billed (17 Jun).`,
    );
  });

  it('reads days in a row as a range', () => {
    expect(
      withBilledDays(NOTICE, ['2026-06-18', '2026-06-19', '2026-06-22']),
    ).toBe(
      `${NOTICE} 3 days stay logged: they are billed (18–19 Jun, 22 Jun).`,
    );
  });

  it('shows the years of days in two years', () => {
    expect(withBilledDays(NOTICE, ['2026-12-31', '2027-01-01'])).toBe(
      `${NOTICE} 2 days stay logged: they are billed (31 Dec 2026 – 1 Jan 2027).`,
    );
  });
});
