export interface ITeamFileRow {
  // The line in the file; the header is 1.
  row: number;
  name: string;
  email: string;
  team: string;
  lead: string;
}
