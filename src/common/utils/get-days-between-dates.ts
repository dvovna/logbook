const getDaysBetweenDates = (startDate: Date, endDate: Date): number => {
  if (startDate > endDate) {
    throw new Error('startDate must be earlier than endDate');
  }

  const timeDifference = endDate.getTime() - startDate.getTime();
  const daysDifference = timeDifference / (1000 * 3600 * 24);

  return daysDifference + 1;
};

export default getDaysBetweenDates;
