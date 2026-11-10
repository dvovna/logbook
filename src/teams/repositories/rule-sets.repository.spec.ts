import { recordingDatabase } from 'src/database/testing/recording-database';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';

describe('RuleSetsRepository', () => {
  it('ensureDefault inserts with on conflict do nothing and selects the default of the workspace', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [],
      [
        {
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
        },
      ],
    ]);

    const ruleSet = await new RuleSetsRepository(database).ensureDefault(
      'team-1',
    );

    expect(ruleSet.id).toBe('rule-set-1');
    expect(sqlOf(0)).toContain('insert into "rule_sets"');
    expect(sqlOf(0)).toContain('on conflict do nothing');
    expect(parametersOf(0)).toEqual(expect.arrayContaining(['team-1', true]));
    expect(sqlOf(1)).toContain('"is_default" = $');
    expect(sqlOf(1)).toContain('"slack_team_id" = $');
    expect(parametersOf(1)).toEqual(expect.arrayContaining(['team-1', true]));
  });
});
