export const getDateOnly = (input: string | Date) => {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toISOString().split('T')[0];
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Read in UTC: the app stores calendar dates ('2026-07-06') and compares them
// in UTC, so a date never shifts by a day.
const dateParts = (input: string | Date) => {
  const date = typeof input === 'string' ? new Date(input) : input;

  return {
    day: date.getUTCDate(),
    month: MONTHS[date.getUTCMonth()],
    year: date.getUTCFullYear(),
  };
};

// '6 Jul 2026': reads the same wherever the reader lives, unlike 7/6/2026.
export const formatDate = (input: string | Date) => {
  const { day, month, year } = dateParts(input);

  return `${day} ${month} ${year}`;
};

// '6–10 Jul 2026', '28 Jun – 3 Jul 2026', '28 Dec 2026 – 2 Jan 2027', or
// one date when both are the same day.
export const formatDateRange = (start: string | Date, end: string | Date) => {
  const from = dateParts(start);
  const to = dateParts(end);

  if (from.year !== to.year) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }

  if (from.month !== to.month) {
    return `${from.day} ${from.month} – ${to.day} ${to.month} ${to.year}`;
  }

  if (from.day !== to.day) {
    return `${from.day}–${to.day} ${to.month} ${to.year}`;
  }

  return formatDate(end);
};
