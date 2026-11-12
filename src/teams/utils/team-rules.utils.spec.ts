import { vacationPolicyOfTeam } from 'src/teams/utils/team-rules.utils';
import { IWorkspaceTeamRules } from 'src/teams/types/effective-team-rules.interface';

const rules = {
  companyRules: { vacation_policy_id: 'policy-company' },
  teams: [
    { team: { id: 'team-own' }, vacationPolicyId: 'policy-own' },
    { team: { id: 'team-without' }, vacationPolicyId: null },
    { team: { id: 'team-following' }, vacationPolicyId: 'policy-company' },
  ],
} as unknown as IWorkspaceTeamRules;

describe('vacationPolicyOfTeam', () => {
  const policyOf = vacationPolicyOfTeam(rules);

  it("is a team's policy", () => {
    expect(policyOf('team-own')).toBe('policy-own');
    expect(policyOf('team-following')).toBe('policy-company');
  });

  it('is none for a team of its own rules without a policy', () =>
    expect(policyOf('team-without')).toBeNull());

  it("is the company rules' for no team or a team that isn't the workspace's", () => {
    expect(policyOf(null)).toBe('policy-company');
    expect(policyOf(undefined)).toBe('policy-company');
    expect(policyOf('team-elsewhere')).toBe('policy-company');
  });
});
