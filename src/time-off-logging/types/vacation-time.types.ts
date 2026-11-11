export interface IVacationTimeParams {
  userId: string;
  teamId: string | null;
  projectId: string;
  // On each day.
  minutes: number;
  dates: string[];
  vacationRequestId: string;
  // Of every entry: what the time is (the leave type).
  description?: string;
  slackTeamId: string;
}

// What VacationTimeService.remove removed: how many entries, whose they were
// (the person who logged them, normally one) with their time and projects,
// and the days whose time stays because it is billed.
export interface IRemovedVacationTime {
  deleted: number;
  owners: { userId: string; minutes: number; projectIds: string[] }[];
  billedDates: string[];
}
