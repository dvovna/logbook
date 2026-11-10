import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  IRelation,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IProjectUserRateViewModel } from 'src/projects/types/project-user-rate.types';

interface ISetRateParams {
  slackTeamId: string;
  projectId: string;
  userId: string;
  hourlyRate: number;
  updatedBy: string;
}

@Injectable()
export class ProjectUserRatesRepository extends BaseRepository<
  'project_user_rates',
  IProjectUserRateViewModel
> {
  protected readonly tableName = 'project_user_rates';
  protected defaultOrderBy = ['project_id:asc'];

  protected readonly uniqueOrder = ['project_id:asc', 'user_id:asc'];

  protected relations: Record<string, IRelation> = {
    user: { table: 'users', foreignKey: 'user_id', columns: ['id', 'name'] },
  };

  protected mapToViewModel = (row: SqlRow<'project_user_rates'>) => {
    const { user } = row as SqlRow<'project_user_rates'> & {
      user?: { id: string; name: string } | null;
    };

    return {
      slack_team_id: row.slack_team_id,
      project_id: row.project_id,
      user_id: row.user_id,
      hourly_rate: row.hourly_rate,
      user: user ? { id: user.id, name: user.name } : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
    };
  };

  // The person's rate on the project, new or changed; a changed one keeps
  // who set it first.
  public async setRate({
    slackTeamId,
    projectId,
    userId,
    hourlyRate,
    updatedBy,
  }: ISetRateParams): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .insertInto('project_user_rates')
      .values({
        slack_team_id: slackTeamId,
        project_id: projectId,
        user_id: userId,
        hourly_rate: hourlyRate,
        created_by: updatedBy,
        updated_by: updatedBy,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['project_id', 'user_id'])
          .doUpdateSet({
            hourly_rate: hourlyRate,
            updated_by: updatedBy,
            updated_at: now,
          })
          // A row of another workspace is never changed.
          .where('project_user_rates.slack_team_id', '=', slackTeamId),
      )
      .execute();
  }
}
