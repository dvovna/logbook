// Dates are YYYY-MM-DD: the span of the approved time off that covers the day.
export interface IAbsence {
  userId: string;
  since: string;
  until: string;
}
