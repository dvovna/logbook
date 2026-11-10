import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  IRelation,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';

@Injectable()
export class RuleSetsRepository extends BaseRepository<
  'rule_sets',
  IRuleSetViewModel
> {
  protected readonly tableName = 'rule_sets';

  protected relations: Record<string, IRelation> = {
    vacation_policy: {
      table: 'vacation_policies',
      foreignKey: 'vacation_policy_id',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'rule_sets'>) => {
    const { vacation_policy } = row as SqlRow<'rule_sets'> & {
      vacation_policy: { id: string; name: string } | null;
    };

    return {
      id: row.id,
      slack_team_id: row.slack_team_id,
      name: row.name,
      is_default: row.is_default,
      hr_approvers: row.hr_approvers,
      hr_approvers_rule: row.hr_approvers_rule as ApprovalRule,
      approval_notification_recipients: row.approval_notification_recipients,
      vacation_policy_id: row.vacation_policy_id,
      vacation_policy,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    };
  };

  // The workspace's company rules. Two calls at once give one row: the
  // insert yields to the unique index on the default set, whoever was first.
  public async ensureDefault(slackTeamId: string): Promise<IRuleSetViewModel> {
    await this.db
      .insertInto('rule_sets')
      .values({ slack_team_id: slackTeamId, is_default: true })
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    const ruleSet = await this.findOne({
      slack_team_id: slackTeamId,
      is_default: true,
    });

    if (!ruleSet) {
      throw new Error(
        `[rule_sets] the company rules of ${slackTeamId} are missing`,
      );
    }

    return ruleSet;
  }
}
