const getDaysBetweenDays = (startDate: Date, endDate: Date): number => {
  if (startDate > endDate) {
    throw new Error('startDate must be earlier than endDate');
  }

  if (startDate.getTime() === endDate.getTime()) {
    return 1;
  }

  const timeDifference = endDate.getTime() - startDate.getTime();
  const daysDifference = timeDifference / (1000 * 3600 * 24);

  return Math.ceil(daysDifference);
};

export default getDaysBetweenDays;
