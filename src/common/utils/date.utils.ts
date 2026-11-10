export const DAY_MS = 24 * 60 * 60 * 1000;

export const getDateOnly = (input: string | Date) => {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toISOString().split('T')[0];
};

// "2026-11-03", and a day that exists (not "2026-02-30").
export const isIsoDate = (date: unknown): date is string => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const time = Date.parse(`${date}T00:00:00Z`);

  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date);
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toDate = (input: string | Date) =>
  typeof input === 'string' ? new Date(input) : input;

// Read in UTC: the app stores calendar dates ('2026-07-06') and compares them
// in UTC, so a date never shifts by a day.
const dateParts = (input: string | Date) => {
  const date = toDate(input);

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

// '6 Jul': a date whose year goes without saying.
export const formatDayMonth = (input: string | Date) => {
  const { day, month } = dateParts(input);

  return `${day} ${month}`;
};

// 'Mon'
export const weekdayOf = (input: string | Date) =>
  WEEKDAYS[toDate(input).getUTCDay()];

// 'Mon, 6 Jul 2026': a day in a list grouped by day.
export const formatDay = (input: string | Date) =>
  `${weekdayOf(input)}, ${formatDate(input)}`;

// The week of Monday 15 June 2026: '15 Jun'.
export const weekLabel = (weekStart: string) => formatDayMonth(weekStart);

const formatRange = (
  start: string | Date,
  end: string | Date,
  withYear: boolean,
) => {
  const from = dateParts(start);
  const to = dateParts(end);
  const year = withYear ? ` ${to.year}` : '';

  if (from.year !== to.year) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }

  if (from.month !== to.month) {
    return `${formatDayMonth(start)} – ${formatDayMonth(end)}${year}`;
  }

  if (from.day !== to.day) {
    return `${from.day}–${to.day} ${to.month}${year}`;
  }

  return `${formatDayMonth(end)}${year}`;
};

// '6–10 Jul 2026', '28 Jun – 3 Jul 2026', '28 Dec 2026 – 2 Jan 2027', or
// one date when both are the same day.
export const formatDateRange = (start: string | Date, end: string | Date) =>
  formatRange(start, end, true);

// Sorted days ('YYYY-MM-DD') as a list in which days in a row read as a
// range, the year only when the days span two: '17–18 Jun, 22 Jun',
// '31 Dec 2026 – 1 Jan 2027'.
export const formatDateList = (dates: string[]) => {
  const runs: { start: string; end: string }[] = [];

  for (const date of dates) {
    const last = runs[runs.length - 1];

    if (last && Date.parse(date) - Date.parse(last.end) === DAY_MS) {
      last.end = date;
    } else {
      runs.push({ start: date, end: date });
    }
  }

  const oneYear =
    dates[0]?.slice(0, 4) === dates[dates.length - 1]?.slice(0, 4);

  return runs
    .map(({ start, end }) => formatRange(start, end, !oneYear))
    .join(', ');
};
