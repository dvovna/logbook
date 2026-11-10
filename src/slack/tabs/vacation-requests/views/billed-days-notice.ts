import pluralize from 'pluralize';
import { formatDateRange } from '@common/utils/date.utils';

const DAY_MS = 24 * 60 * 60 * 1000;

// Days in a row read as a range; the year shows only when the days span two.
const billedDays = (dates: string[]) => {
  const runs: { start: string; end: string }[] = [];

  for (const date of dates) {
    const last = runs[runs.length - 1];

    if (last && Date.parse(date) - Date.parse(last.end) === DAY_MS) {
      last.end = date;
    } else {
      runs.push({ start: date, end: date });
    }
  }

  const oneYear = dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4);
  const days = runs
    .map(({ start, end }) => formatDateRange(start, end))
    .map((range) => (oneYear ? range.replace(/ \d{4}$/, '') : range))
    .join(', ');

  return dates.length === 1
    ? `1 day stays logged: it is billed (${days}).`
    : `${pluralize('day', dates.length, true)} stay logged: they are billed (${days}).`;
};

// `notice`, and the days of the vacation whose logged time stayed when it
// changed, because a billing snapshot holds it: '✅ Vacation request updated.
// 2 days stay logged: they are billed (17–18 Jun).' `billedDates` are sorted
// 'YYYY-MM-DD'.
export const withBilledDays = (notice: string, billedDates: string[]) =>
  billedDates.length ? `${notice} ${billedDays(billedDates)}` : notice;
