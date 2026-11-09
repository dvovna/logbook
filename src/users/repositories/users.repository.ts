import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
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

  // The users `userIds` of the workspace become the team's members, and its
  // other members leave it. Returns the members. Several statements: the
  // caller runs them in one transaction.
  public async setTeamMembers(params: {
    slackTeamId: string;
    teamId: string;
    userIds: string[];
    updatedBy: string;
  }): Promise<IUserViewModel[]> {
    const { slackTeamId, teamId, userIds, updatedBy } = params;
    const team = await this.db
      .selectFrom('teams')
      .select('id')
      .where('slack_team_id', '=', slackTeamId)
      .where('id', '=', teamId)
      .executeTakeFirst();

    if (!team) {
      throw new Error(`Team ${teamId} is not in workspace ${slackTeamId}`);
    }

    const changed = {
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    };

    await this.updateInWorkspace(slackTeamId)
      .set({ team_id: null, ...changed })
      .where('team_id', '=', teamId)
      .$if(userIds.length > 0, (query) => query.where('id', 'not in', userIds))
      .execute();

    if (userIds.length === 0) {
      return [];
    }

    const members = await this.updateInWorkspace(slackTeamId)
      .set({ team_id: teamId, ...changed })
      .where('id', 'in', userIds)
      .returningAll()
      .execute();

    return members.map(this.mapToViewModel);
  }
}
