import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';
import ITeamViewModel from 'src/teams/types/team.interface';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';

@Injectable()
export class TeamsRepository extends BaseRepository<
  Tables['teams'],
  ITeamViewModel
> {
  protected tableName: TableName = 'teams';

  protected mapToViewModel = (row: Tables['teams']['Row']) => {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      slack_team_id: row.slack_team_id,
      vacation_policy_id: row.vacation_policy_id,
      manager_approvers: row.manager_approvers,
      hr_approvers: row.hr_approvers,
      approval_notification_recipients: row.approval_notification_recipients,
      manager_approvers_rule: row.manager_approvers_rule as ApprovalRule | null,
      hr_approvers_rule: row.hr_approvers_rule as ApprovalRule | null,
      is_primary: row.is_primary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
    };
  };
}
