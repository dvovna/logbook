export interface ISetupProgress {
  hasPolicy: boolean;
  // The company rules name a level 2 approver, or every team has its own.
  hasCompanyApprovers: boolean;
  hasTeamWithApprovers: boolean;
  // Active people in no team: their requests go to HR or the admins.
  peopleWithoutTeam: number;
  // Optional: only for time tracking.
  hasProjects: boolean;
  // Optional: balances or history from a leave file were applied.
  hasLeaveImport: boolean;
}
