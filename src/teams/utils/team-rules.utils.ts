import { IWorkspaceTeamRules } from '@modules/teams/types/effective-team-rules.interface';

// The vacation policy that a person in `teamId`, or a request filed in it,
// follows: the team's (a team of its own rules may have none), or the
// company rules' for no team or a team that isn't the workspace's.
export const vacationPolicyOfTeam = ({
  companyRules,
  teams,
}: IWorkspaceTeamRules): ((
  teamId: string | null | undefined,
) => string | null) => {
  const policies = new Map(
    teams.map(({ team, vacationPolicyId }) => [team?.id, vacationPolicyId]),
  );

  return (teamId) =>
    teamId && policies.has(teamId)
      ? (policies.get(teamId) ?? null)
      : companyRules.vacation_policy_id;
};
