import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ITimeOffProjectViewModel } from 'src/time-off-logging/types/time-off-settings.types';

@Injectable()
export class TimeOffProjectsRepository extends BaseRepository<
  'time_off_projects',
  ITimeOffProjectViewModel
> {
  protected readonly tableName = 'time_off_projects';
  protected defaultOrderBy = ['vacation_type:asc'];

  protected readonly uniqueOrder = ['vacation_type:asc'];

  // Each leave type's project with its name, in one statement; a type whose
  // project was archived is left out.
  public findWithActiveProjects(
    slackTeamId: string,
  ): Promise<{ vacation_type: string; project_name: string }[]> {
    if (!slackTeamId) {
      throw new Error('[time_off_projects] query without slack_team_id');
    }

    return this.db
      .selectFrom('time_off_projects')
      .innerJoin('projects', 'projects.id', 'time_off_projects.project_id')
      .select([
        'time_off_projects.vacation_type',
        'projects.name as project_name',
      ])
      .where('time_off_projects.slack_team_id', '=', slackTeamId)
      .where('projects.slack_team_id', '=', slackTeamId)
      .where('projects.archived_at', 'is', null)
      .execute();
  }

  protected mapToViewModel = (row: SqlRow<'time_off_projects'>) => ({
    slack_team_id: row.slack_team_id,
    vacation_type: row.vacation_type,
    project_id: row.project_id,
  });
}
