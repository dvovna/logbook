export interface ISetupProgress {
  hasPolicy: boolean;
  // The company rules name a level 2 approver, or every team has its own.
  hasCompanyApprovers: boolean;
  hasTeamWithApprovers: boolean;
  // The company rules name level 2 approvers, who get the requests of
  // people in no team (they have no level 1). Without them those requests
  // go to HR or the admins.
  companyRulesNameApprovers: boolean;
  // Active people in no team.
  peopleWithoutTeam: number;
  // Optional: only for time tracking.
  hasProjects: boolean;
}
