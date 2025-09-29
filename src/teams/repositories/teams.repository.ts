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

  protected relations = {
    vacation_policy: 'vacation_policy_id ( id, name )',
  };

  protected mapToViewModel = (row: Tables['teams']['Row']) => {
    const extendedRow = row as Tables['teams']['Row'] & {
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
