import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { callFunction } from 'src/database/sql-functions';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
export class UsersRepository extends SqlRepository<'users', IUserViewModel> {
  protected readonly tableName = 'users';

  protected searchableColumns = ['name', 'email'];

  // Active members per team ID.
  public async getUsersCountByTeam(
    slackTeamId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .select((eb) => ['team_id', eb.fn.countAll<number>().as('count')])
      .where('is_active', '=', true)
      .where('team_id', 'is not', null)
      .groupBy('team_id')
      .execute();

    return Object.fromEntries(
      rows.map(({ team_id, count }) => [team_id!, Number(count)]),
    );
  }

  protected mapToViewModel = (row: SqlRow<'users'>) => {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      is_active: row.is_active,
      carryover_days: row.carryover_days,
      role: row.role as UserRole,
      contract_start_date: row.contract_start_date,
      slack_id: row.slack_id,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    };
  };

  // In one transaction (set_team_members): the users `userIds` are the
  // team's members, and nobody else. Returns them.
  public async setTeamMembers(params: {
    slackTeamId: string;
    teamId: string;
    userIds: string[];
    updatedBy: string;
  }): Promise<IUserViewModel[]> {
    const rows = await callFunction(this.db, 'set_team_members', {
      p_slack_team_id: params.slackTeamId,
      p_team_id: params.teamId,
      p_user_ids: params.userIds,
      p_updated_by: params.updatedBy,
    });

    return rows.map(this.mapToViewModel);
  }
}
