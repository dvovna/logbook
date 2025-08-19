import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from 'src/common/repositories/base.repository';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export class UsersRepository extends BaseRepository<
  Tables['users'],
  IUserViewModel
> {
  protected readonly tableName = 'users';

  public async getUsersCountByTeam(slackTeamId: string) {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('id, team_id')
      .eq('slack_team_id', slackTeamId);

    if (error) {
      throw new Error(`Failed to fetch users count by team: ${error.message}`);
    }

    return (data || []).reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.team_id] = (acc[row.team_id] || 0) + 1;

        return acc;
      },
      {} as Record<string, number>,
    );
  }

  protected mapToViewModel = (row: Tables['users']['Row']) => {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as UserRole,
      contract_start_date: row.contract_start_date,
      slack_id: row.slack_id,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      created_at: row.created_at,
    };
  };
}
