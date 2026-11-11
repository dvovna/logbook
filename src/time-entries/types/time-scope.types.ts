// Whose time a person sees in reports and exports:
// - workspace: Admin, HR and Finance (COMPANY_TIME_ROLES), everyone's;
// - teams: a manager, the time logged in the teams that list them among
//   their manager approvers, and their own;
// - own: everyone else, and a manager of no team, only their own.
export type TimeScope =
  | { kind: 'workspace' }
  | { kind: 'teams'; teamIds: string[] }
  | { kind: 'own' };

export type TimeScopeKind = TimeScope['kind'];

// A scope as conditions on entries: none for the workspace; else the
// entries of `userId` and those logged in `teamIds`.
export interface ITimeScopeFilter {
  userId?: string;
  teamIds?: string[];
}
