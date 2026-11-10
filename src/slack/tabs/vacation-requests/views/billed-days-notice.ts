import pluralize from 'pluralize';
import { formatDateList } from '@common/utils/date.utils';

const billedDays = (dates: string[]) => {
  const days = formatDateList(dates);

  return dates.length === 1
    ? `1 day stays logged: it is billed (${days}).`
    : `${pluralize('day', dates.length, true)} stay logged: they are billed (${days}).`;
};

// `billedDates` (sorted 'YYYY-MM-DD'): the days whose logged time stayed
// because a billing snapshot holds it.
export const withBilledDays = (notice: string, billedDates: string[]) =>
  billedDates.length ? `${notice} ${billedDays(billedDates)}` : notice;
