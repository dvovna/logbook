import pluralize from 'pluralize';
import { formatDateList } from '@common/utils/date.utils';

const billedDays = (dates: string[]) => {
  const days = formatDateList(dates);

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
