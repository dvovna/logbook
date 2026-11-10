import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
export class UsersRepository extends BaseRepository<'users', IUserViewModel> {
  protected readonly tableName = 'users';

  protected searchableColumns = ['name', 'email'];

  // The workspace whose Slack ID is `workspaceSlackId` and its user whose
  // Slack ID is `userSlackId`, in one statement: what every Slack request
  // looks up first. workspaceId is null without such a workspace, user
  // without such a user in it.
  public async findInWorkspaceBySlackIds(
    workspaceSlackId: string,
    userSlackId: string,
  ): Promise<{ workspaceId: string | null; user: IUserViewModel | null }> {
    const row = await this.db
      .selectFrom('slack_teams')
      .leftJoin('users', (join) =>
        join
          .onRef('users.slack_team_id', '=', 'slack_teams.id')
          .on('users.slack_id', '=', userSlackId),
      )
      .selectAll('users')
      .select('slack_teams.id as workspace_id')
      .where('slack_teams.slack_id', '=', workspaceSlackId)
      .executeTakeFirst();

    return {
      workspaceId: row?.workspace_id ?? null,
      user: row?.id ? this.toViewModel(row) : null,
    };
  }

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
