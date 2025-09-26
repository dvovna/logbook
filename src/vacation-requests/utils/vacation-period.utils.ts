export const getCurrentVacationPeriod = (
  contractStartDate: string,
  today = new Date(),
) => {
  const start = new Date(contractStartDate); // e.g. 2020-05-15
  const currentYear = today.getFullYear();

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
