import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';

@Injectable()
export default class VacationPoliciesRepository extends BaseRepository<
  'vacation_policies',
  IVacationPolicyViewModel
> {
  protected readonly tableName = 'vacation_policies';

  // The policy, its row locked till the transaction ends: a team or the
  // company rules given the policy meanwhile wait for it, since their
  // foreign key locks the row too, and are counted once they commit.
  public async findForDelete(
    id: string,
    slackTeamId: string,
  ): Promise<IVacationPolicyViewModel | null> {
    const row = await this.selectInWorkspace(slackTeamId)
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    return row ? this.mapToViewModel(row) : null;
  }

  protected mapToViewModel = (data: SqlRow<'vacation_policies'>) => {
    return {
      id: data.id,
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
