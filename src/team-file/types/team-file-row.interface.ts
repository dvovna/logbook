export interface ITeamFileRow {
  // The line (a CSV) or row (a sheet) number as the person sees it in the file.
  row: number;
  name: string;
  email: string;
  team: string;
  lead: string;
}
