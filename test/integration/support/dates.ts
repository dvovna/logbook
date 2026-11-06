const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// Monday to Friday of a week in the future, as YYYY-MM-DD: 1 is next week.
// Relative to today, so the tests keep working as time passes.
export const workWeek = (weeksAhead = 1) => {
  const today = new Date();
  const monday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const daysToNextMonday = (8 - monday.getUTCDay()) % 7 || 7;

  monday.setUTCDate(
    monday.getUTCDate() + daysToNextMonday + 7 * (weeksAhead - 1),
  );

  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  return { start: isoDate(monday), end: isoDate(friday) };
};

export const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);

  return isoDate(result);
};
