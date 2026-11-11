import { recordingDatabase } from 'src/database/testing/recording-database';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

const teamRow = {
  id: 'team-1',
  slack_team_id: 'ws-1',
  name: 'Ops',
  description: null,
  vacation_policy_id: null,
  rule_set_id: 'rule-set-1',
  manager_approvers: ['UMGR'],
  hr_approvers: null,
  approval_notification_recipients: null,
  manager_approvers_rule: 'ANY',
  hr_approvers_rule: 'ANY',
  created_at: '2026-11-12T10:00:00.000000+00:00',
  updated_at: '2026-11-12T10:00:00.000000+00:00',
  created_by: null,
  updated_by: null,
  vacation_policy: null,
};

const companyRules = {
  hr_approvers: ['UHR'],
  hr_approvers_rule: 'ALL',
  approval_notification_recipients: [],
  vacation_policy_id: 'policy-1',
};

describe('TeamsRepository', () => {
  it("findOneWithCompanyRules reads the workspace's team and its company rules in one statement", async () => {
    const { database, queries, sqlOf, parametersOf } = recordingDatabase([
      [{ ...teamRow, company_rules: companyRules }],
    ]);

    const found = await new TeamsRepository(database).findOneWithCompanyRules(
      'team-1',
      'ws-1',
    );

    expect(found).toMatchObject({
      team: { id: 'team-1', rule_set_id: 'rule-set-1', vacation_policy: null },
      companyRules: { ...companyRules, hr_approvers_rule: ApprovalRule.All },
    });
    expect(queries).toHaveLength(1);
    expect(sqlOf(0)).toContain('"teams"."slack_team_id" = $');
    expect(sqlOf(0)).toContain(
      '"rule_sets"."slack_team_id" = "teams"."slack_team_id"',
    );
    expect(sqlOf(0)).toContain('"rule_sets"."is_default" = $');
    expect(parametersOf(0)).toEqual(
      expect.arrayContaining(['ws-1', 'team-1', true]),
    );
  });

  it("findOneWithCompanyRules is null for a team that isn't the workspace's", async () => {
    const { database } = recordingDatabase([[]]);

    expect(
      await new TeamsRepository(database).findOneWithCompanyRules(
        'team-2',
        'ws-1',
      ),
    ).toBeNull();
  });
});
