const DAY_MS = 24 * 60 * 60 * 1000;

const monthStart = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);

const partsOf = (date: string) => ({
  year: Number(date.slice(0, 4)),
  monthIndex: Number(date.slice(5, 7)) - 1,
});

export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`;

// The month after `month`, on `dueDay`: October's receipts are due in November.
export const dueDateOf = (month: string, dueDay: number): string => {
  const { year, monthIndex } = partsOf(month);

  return `${monthStart(year, monthIndex + 1).slice(0, 8)}${String(dueDay).padStart(2, '0')}`;
};

// What is being collected today: up to and on the due day it is still last
// month's, after it this month's.
export const collectedMonth = (today: string, dueDay: number): string => {
  const { year, monthIndex } = partsOf(today);

  return Number(today.slice(8, 10)) <= dueDay
    ? monthStart(year, monthIndex - 1)
    : monthStart(year, monthIndex);
};

// This month and the two before, newest first.
export const offeredMonths = (today: string): string[] => {
  const { year, monthIndex } = partsOf(today);

  return [0, 1, 2].map((back) => monthStart(year, monthIndex - back));
};

// Late from the first instant after the due day (UTC).
export const isLate = (
  submittedAt: string,
  month: string,
  dueDay: number,
): boolean =>
  Date.parse(submittedAt) >=
  Date.parse(`${dueDateOf(month, dueDay)}T00:00:00Z`) + DAY_MS;

export const monthLabel = (month: string): string =>
  new Date(`${month}T00:00:00Z`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
