import {
  MAX_TEAM_LEADS,
  MAX_TEAM_NAME_LENGTH,
} from '@modules/teams/constants/team-limits';

export const TEAM_FILE_UNUSABLE_REASONS = {
  noEmail: 'Row has no email',
  notInWorkspace: (email: string) => `${email} isn't in this Slack workspace`,
  deactivated: (name: string) => `${name} is deactivated`,
  duplicate: (email: string, row: number) =>
    `${email} is already on row ${row}`,
  invalidLead: 'Team lead must be yes or empty',
  leadWithoutTeam: (name: string) =>
    `${name} is marked as lead but has no team`,
  cannotLead: (name: string, roleLabel: string) =>
    `${name} has the ${roleLabel} role, which can't approve a team's time off`,
  ambiguousTeam: (team: string) =>
    `${team} matches more than one team; write its exact name`,
  teamNameTooLong: (team: string) =>
    `${team} is longer than ${MAX_TEAM_NAME_LENGTH} characters`,
  teamLimit: (maxTeams: number, team: string) =>
    `Logbook allows ${maxTeams} teams; ${team} would be one more`,
  tooManyLeads: (team: string) =>
    `${team} would have more than ${MAX_TEAM_LEADS} leads`,
};
