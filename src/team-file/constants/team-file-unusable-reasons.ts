export const TEAM_FILE_UNUSABLE_REASONS = {
  noEmail: 'Row has no email',
  notInWorkspace: (email: string) => `${email} isn't in this Slack workspace`,
  deactivated: (name: string) => `${name} is deactivated`,
  duplicate: (email: string, row: number) =>
    `${email} is already on row ${row}`,
  invalidLead: 'Team lead must be yes or empty',
  leadWithoutTeam: (name: string) =>
    `${name} is marked as lead but has no team`,
  cannotLead: (name: string, role: string) =>
    `${name} has the ${role} role, which can't approve at level 1`,
  teamLimit: (maxTeams: number, team: string) =>
    `Logbook allows ${maxTeams} teams; ${team} would be one more`,
};
