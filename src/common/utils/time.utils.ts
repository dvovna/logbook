export const convertToHours = (minutes: number) => {
  return minutes / 60;
};

export const getDisplayTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${remainingMinutes}m`;
  }
};

export const sumMinutes = (entries: { minutes: number }[]) =>
  entries.reduce((sum, { minutes }) => sum + minutes, 0);
