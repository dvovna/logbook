import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';

const ruleSet = {
  id: 'set-1',
  hr_approvers: ['UHR'],
  hr_approvers_rule: ApprovalRule.All,
  approval_notification_recipients: ['UREC'],
  vacation_policy_id: 'policy-company',
} as IRuleSetViewModel;

const team = (overrides: Partial<ITeamViewModel> = {}) =>
  ({
    id: 'team-1',
    slack_team_id: 'ws-1',
    rule_set_id: 'set-1',
    manager_approvers: ['UMGR'],
    manager_approvers_rule: ApprovalRule.All,
    hr_approvers: ['UOWNHR'],
    hr_approvers_rule: ApprovalRule.Any,
    approval_notification_recipients: ['UOWNREC'],
    vacation_policy_id: 'policy-own',
    ...overrides,
  }) as ITeamViewModel;

describe('TeamRulesService', () => {
  // `found` comes with the company rules, as the one statement reads them.
  const setup = (found: ITeamViewModel | null, all: ITeamViewModel[] = []) => {
    const teamsRepository = {
      findOneWithCompanyRules: jest
        .fn()
        .mockResolvedValue(found && { team: found, companyRules: ruleSet }),
      findMany: jest.fn().mockResolvedValue(all),
    };
    const ruleSetsRepository = {
      ensureDefault: jest.fn().mockResolvedValue(ruleSet),
    };
    const service = new TeamRulesService(
      teamsRepository as never,
      ruleSetsRepository as never,
    );

    return { service, teamsRepository, ruleSetsRepository };
  };

  it('forTeam(null) returns the company rules with no level 1', async () => {
    const { service, teamsRepository } = setup(null);

    expect(await service.forTeam(null, 'ws-1')).toEqual({
      team: null,
      followsCompanyRules: true,
      managerApprovers: [],
      managerApproversRule: ApprovalRule.Any,
      hrApprovers: ['UHR'],
      hrApproversRule: ApprovalRule.All,
      notificationRecipients: ['UREC'],
      vacationPolicyId: 'policy-company',
    });
    expect(teamsRepository.findOneWithCompanyRules).not.toHaveBeenCalled();
  });

  it('forTeam of a team that follows company rules takes level 2, recipients and policy from the set and level 1 from the team, in one read', async () => {
    const found = team();
    const { service, teamsRepository, ruleSetsRepository } = setup(found);

    expect(await service.forTeam('team-1', 'ws-1')).toEqual({
      team: found,
      followsCompanyRules: true,
      managerApprovers: ['UMGR'],
      managerApproversRule: ApprovalRule.All,
      hrApprovers: ['UHR'],
      hrApproversRule: ApprovalRule.All,
      notificationRecipients: ['UREC'],
      vacationPolicyId: 'policy-company',
    });
    expect(teamsRepository.findOneWithCompanyRules).toHaveBeenCalledWith(
      'team-1',
      'ws-1',
    );
    expect(ruleSetsRepository.ensureDefault).not.toHaveBeenCalled();
  });

  it('forTeam of a team with its own rules returns its own columns', async () => {
    const found = team({ rule_set_id: null });
    const { service, ruleSetsRepository } = setup(found);

    expect(await service.forTeam('team-1', 'ws-1')).toEqual({
      team: found,
      followsCompanyRules: false,
      managerApprovers: ['UMGR'],
      managerApproversRule: ApprovalRule.All,
      hrApprovers: ['UOWNHR'],
      hrApproversRule: ApprovalRule.Any,
      notificationRecipients: ['UOWNREC'],
      vacationPolicyId: 'policy-own',
    });
    expect(ruleSetsRepository.ensureDefault).not.toHaveBeenCalled();
  });

  it('forTeam creates the company rules a following team finds missing', async () => {
    const { service, teamsRepository, ruleSetsRepository } = setup(null);
    teamsRepository.findOneWithCompanyRules.mockResolvedValue({
      team: team(),
      companyRules: null,
    });

    expect((await service.forTeam('team-1', 'ws-1')).hrApprovers).toEqual([
      'UHR',
    ]);
    expect(ruleSetsRepository.ensureDefault).toHaveBeenCalledWith('ws-1');
  });

  it('forTeam of a team id that is not in the workspace returns the company rules', async () => {
    const { service } = setup(null);

    const rules = await service.forTeam('other-ws-team', 'ws-1');

    expect(rules.team).toBeNull();
    expect(rules.followsCompanyRules).toBe(true);
    expect(rules.managerApprovers).toEqual([]);
    expect(rules.hrApprovers).toEqual(['UHR']);
  });

  it('forWorkspace resolves each team of the workspace, reading the company rules once', async () => {
    const following = team({ id: 'team-1' });
    const own = team({ id: 'team-2', rule_set_id: null });
    const { service, teamsRepository, ruleSetsRepository } = setup(null, [
      following,
      own,
    ]);

    const { companyRules, teams: rules } = await service.forWorkspace('ws-1');

    expect(companyRules).toBe(ruleSet);
    expect(
      rules.map(
        ({ team, followsCompanyRules, hrApprovers, vacationPolicyId }) => ({
          id: team?.id,
          followsCompanyRules,
          hrApprovers,
          vacationPolicyId,
        }),
      ),
    ).toEqual([
      {
        id: 'team-1',
        followsCompanyRules: true,
        hrApprovers: ['UHR'],
        vacationPolicyId: 'policy-company',
      },
      {
        id: 'team-2',
        followsCompanyRules: false,
        hrApprovers: ['UOWNHR'],
        vacationPolicyId: 'policy-own',
      },
    ]);
    expect(teamsRepository.findMany).toHaveBeenCalledWith({
      slack_team_id: 'ws-1',
    });
    expect(ruleSetsRepository.ensureDefault).toHaveBeenCalledTimes(1);
  });
});
