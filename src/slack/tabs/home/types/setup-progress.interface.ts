export interface ISetupProgress {
  // A vacation policy applies to someone: the company rules or a team with
  // rules of its own name one. A policy nobody uses limits nothing.
  policyApplies: boolean;
  // Someone saved the company rules (a second approval or none, who hears of
  // decisions), or every team has rules of its own.
  companyRulesSet: boolean;
  hasTeamWithApprovers: boolean;
  // The company rules name a second approval, which gets the requests of
  // people in no team (they have no team approval). Without one, or when
  // nobody on it can decide, those requests go to HR or the admins.
  companyRulesNameApprovers: boolean;
  // Active people in no team.
  peopleWithoutTeam: number;
  // The last step: someone took the message that tells people about Logbook.
  teamTold: boolean;
  // Optional: only for time tracking.
  hasProjects: boolean;
  // Optional: balances or history from a leave file were applied.
  hasLeaveImport: boolean;
}
