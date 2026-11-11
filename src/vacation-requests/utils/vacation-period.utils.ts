// The vacation year runs from the contract anniversary. Users without a
// contract start date are tracked over the calendar year.
export const getCurrentVacationPeriod = (
  contractStartDate: string | null | undefined,
  today = new Date(),
) => {
  const currentYear = today.getFullYear();

  if (!contractStartDate) {
    return {
      periodStart: new Date(currentYear, 0, 1),
      periodEnd: new Date(currentYear, 11, 31),
    };
  }

  const start = new Date(contractStartDate); // e.g. 2020-05-15

  const currentPeriodStart = new Date(
    currentYear,
    start.getMonth(),
    start.getDate(),
  );

  const periodStart =
    today >= currentPeriodStart
      ? currentPeriodStart
      : new Date(currentYear - 1, start.getMonth(), start.getDate());
  const periodEnd =
    today >= currentPeriodStart
      ? new Date(currentYear + 1, start.getMonth(), start.getDate() - 1)
      : new Date(currentYear, start.getMonth(), start.getDate() - 1);

  return { periodStart, periodEnd };
};

// The vacation years that hold some day from `start` to `end`, in order:
// one, or more for a vacation across the anniversary.
export const getVacationPeriodsBetween = (
  contractStartDate: string | null | undefined,
  start: Date,
  end: Date,
) => {
  const periods = [getCurrentVacationPeriod(contractStartDate, start)];
  let last = periods[0];

  while (last.periodEnd < end) {
    const next = new Date(last.periodEnd);
    next.setDate(next.getDate() + 1);

    last = getCurrentVacationPeriod(contractStartDate, next);
    periods.push(last);
  }

  return periods;
};
