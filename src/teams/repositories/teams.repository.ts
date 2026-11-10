import { Injectable } from '@nestjs/common';
import {
  IRelation,
  BaseRepository,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

@Injectable()
export class TeamsRepository extends BaseRepository<'teams', ITeamViewModel> {
  protected readonly tableName = 'teams';

  protected relations: Record<string, IRelation> = {
    vacation_policy: {
      table: 'vacation_policies',
      foreignKey: 'vacation_policy_id',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'teams'>) => {
    const extendedRow = row as SqlRow<'teams'> & {
      vacation_policy: { id: string; name: string } | null;
    };

    return {
      id: extendedRow.id,
      name: extendedRow.name,
      description: extendedRow.description || '',
      slack_team_id: extendedRow.slack_team_id,
      vacation_policy_id: extendedRow.vacation_policy_id,
      vacation_policy: extendedRow.vacation_policy,
      manager_approvers: extendedRow.manager_approvers,
      hr_approvers: extendedRow.hr_approvers,
      approval_notification_recipients:
        extendedRow.approval_notification_recipients,
      manager_approvers_rule:
        extendedRow.manager_approvers_rule as ApprovalRule,
      hr_approvers_rule: extendedRow.hr_approvers_rule as ApprovalRule,
      created_at: extendedRow.created_at,
      updated_at: extendedRow.updated_at,
      created_by: extendedRow.created_by,
      updated_by: extendedRow.updated_by,
    };
  };
}
