export const getDateOnly = (input: string | Date) => {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toISOString().split('T')[0];
};
