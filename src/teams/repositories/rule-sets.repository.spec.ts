import { recordingDatabase } from 'src/database/testing/recording-database';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';

const row = {
  id: 'rule-set-1',
  slack_team_id: 'team-1',
  name: null,
  is_default: true,
  hr_approvers: [],
  hr_approvers_rule: 'ANY',
  approval_notification_recipients: [],
  vacation_policy_id: null,
  vacation_policy: null,
  updated_at: '2026-11-12T10:00:00.000000+00:00',
  updated_by: null,
};

describe('RuleSetsRepository', () => {
  it('ensureDefault selects the default of the workspace and stops when it exists', async () => {
    const { database, queries, sqlOf, parametersOf } = recordingDatabase([
      [row],
    ]);

    const ruleSet = await new RuleSetsRepository(database).ensureDefault(
      'team-1',
    );

    expect(ruleSet.id).toBe('rule-set-1');
    expect(queries).toHaveLength(1);
    expect(sqlOf(0)).toContain('"is_default" = $');
    expect(sqlOf(0)).toContain('"slack_team_id" = $');
    expect(parametersOf(0)).toEqual(expect.arrayContaining(['team-1', true]));
  });

  it('ensureDefault inserts with on conflict do nothing and selects again when the default is missing', async () => {
    const { database, queries, sqlOf, parametersOf } = recordingDatabase([
      [],
      [],
      [row],
    ]);

    const ruleSet = await new RuleSetsRepository(database).ensureDefault(
      'team-1',
    );

    expect(ruleSet.id).toBe('rule-set-1');
    expect(queries).toHaveLength(3);
    expect(sqlOf(0)).toContain('select');
    expect(sqlOf(1)).toContain('insert into "rule_sets"');
    expect(sqlOf(1)).toContain('on conflict do nothing');
    expect(parametersOf(1)).toEqual(expect.arrayContaining(['team-1', true]));
    expect(sqlOf(2)).toContain('"is_default" = $');
  });
});
