import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import UserRole from '@common/enums/user-role.enum';
import { ITeamAssignment } from '@modules/users/types/team-assignment.interface';
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
  // other members leave it. Returns the users whose team changed. Several
  // statements: the caller runs them in one transaction.
  public async setTeamMembers(params: {
    slackTeamId: string;
    teamId: string;
    userIds: string[];
    updatedBy: string;
  }): Promise<IUserViewModel[]> {
    const { slackTeamId, teamId, userIds, updatedBy } = params;

    await this.assertTeamsInWorkspace(slackTeamId, [teamId]);

    const changed = {
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    };

    const left = await this.updateInWorkspace(slackTeamId)
      .set({ team_id: null, ...changed })
      .where('team_id', '=', teamId)
      .$if(userIds.length > 0, (query) => query.where('id', 'not in', userIds))
      .returningAll()
      .execute();

    if (userIds.length === 0) {
      return left.map(this.mapToViewModel);
    }

    const joined = await this.updateInWorkspace(slackTeamId)
      .set({ team_id: teamId, ...changed })
      .where('id', 'in', userIds)
      .where('team_id', 'is distinct from', teamId)
      .returningAll()
      .execute();

    return [...left, ...joined].map(this.mapToViewModel);
  }

  // Each user of the workspace in `assignments` moves to their team, or out
  // of any team; one already there is left alone. Returns the users that
  // moved. Several statements: the caller runs them in one transaction.
  public async assignTeams(params: {
    slackTeamId: string;
    assignments: ITeamAssignment[];
    updatedBy: string;
  }): Promise<IUserViewModel[]> {
    const { slackTeamId, assignments, updatedBy } = params;
    const usersByTeam = new Map<string | null, string[]>();

    for (const { userId, teamId } of assignments) {
      usersByTeam.set(teamId, [...(usersByTeam.get(teamId) ?? []), userId]);
    }

    await this.assertTeamsInWorkspace(
      slackTeamId,
      [...usersByTeam.keys()].filter(
        (teamId): teamId is string => teamId !== null,
      ),
    );

    const changed = {
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    };
    const moved: IUserViewModel[] = [];

    for (const [teamId, userIds] of usersByTeam) {
      const rows = await this.updateInWorkspace(slackTeamId)
        .set({ team_id: teamId, ...changed })
        .where('id', 'in', userIds)
        .where('team_id', 'is distinct from', teamId)
        .returningAll()
        .execute();

      moved.push(...rows.map(this.mapToViewModel));
    }

    return moved;
  }

  // Each user moves from `from` to `to` only while they are still in `from`.
  // Returns the users that moved.
  public async restoreTeams(params: {
    slackTeamId: string;
    restores: { userId: string; from: string | null; to: string | null }[];
    updatedBy: string;
  }): Promise<IUserViewModel[]> {
    const { slackTeamId, restores, updatedBy } = params;
    const groups = new Map<
      string,
      { from: string | null; to: string | null; userIds: string[] }
    >();

    for (const { userId, from, to } of restores) {
      const key = `${from}>${to}`;
      const group = groups.get(key) ?? { from, to, userIds: [] };

      group.userIds.push(userId);
      groups.set(key, group);
    }

    await this.assertTeamsInWorkspace(
      slackTeamId,
      [...new Set(restores.map(({ to }) => to))].filter(
        (teamId): teamId is string => teamId !== null,
      ),
    );

    const moved: IUserViewModel[] = [];

    for (const { from, to, userIds } of groups.values()) {
      const rows = await this.updateInWorkspace(slackTeamId)
        .set({
          team_id: to,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy,
        })
        .where('id', 'in', userIds)
        .where('team_id', 'is not distinct from', from)
        .returningAll()
        .execute();

      moved.push(...rows.map(this.mapToViewModel));
    }

    return moved;
  }

  // The foreign key lets a user point at another workspace's team.
  private async assertTeamsInWorkspace(slackTeamId: string, teamIds: string[]) {
    if (teamIds.length === 0) {
      return;
    }

    const teams = await this.db
      .selectFrom('teams')
      .select('id')
      .where('slack_team_id', '=', slackTeamId)
      .where('id', 'in', teamIds)
      .execute();

    if (teams.length !== teamIds.length) {
      const found = new Set(teams.map(({ id }) => id));

      throw new Error(
        `Team ${teamIds.find((id) => !found.has(id))} is not in workspace ${slackTeamId}`,
      );
    }
  }
}
