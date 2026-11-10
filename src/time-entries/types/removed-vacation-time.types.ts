// What deleteVacationTime removed: how many entries, whose they were (the
// person who logged them, normally one) with their time and projects, and
// the days whose time stays because it is billed.
export interface IRemovedVacationTime {
  deleted: number;
  owners: { userId: string; minutes: number; projectIds: string[] }[];
  billedDates: string[];
}
