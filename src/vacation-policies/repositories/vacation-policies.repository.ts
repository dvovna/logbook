import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';
import { Injectable } from '@nestjs/common';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';

@Injectable()
export default class VacationPoliciesRepository extends BaseRepository<
  Tables['vacation_policies'],
  IVacationPolicyViewModel
> {
  protected tableName: TableName = 'vacation_policies';

  protected mapToViewModel = (data: Tables['vacation_policies']['Row']) => {
    return {
      id: data.id,
      is_primary: data.is_primary,
      vacation_days: data.vacation_days,
      slack_team_id: data.slack_team_id,
      bonus_days: data.bonus_days,
      working_days: data.working_days,
      carryover_days: data.carryover_days,
      name: data.name,
      created_at: data.created_at,
      created_by: data.created_by,
      updated_at: data.updated_at,
      updated_by: data.updated_by,
    };
  };
}
