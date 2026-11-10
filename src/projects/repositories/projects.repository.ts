import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import IProjectViewModel from 'src/projects/types/project.types';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';

@Injectable()
export class ProjectsRepository extends BaseRepository<
  'projects',
  IProjectViewModel
> {
  protected readonly tableName = 'projects';

  protected searchableColumns = ['name'];

  // Every project of the workspace, archived ones too, with the name of its
  // client (archived or not), in one statement.
  public findAllWithClientNames(slackTeamId: string): Promise<
    {
      id: string;
      name: string;
      client_id: string | null;
      client_name: string | null;
      billable: boolean;
      archived_at: string | null;
    }[]
  > {
    if (!slackTeamId) {
      throw new Error('[projects] findAllWithClientNames without a workspace');
    }

    return this.db
      .selectFrom('projects')
      .leftJoin('clients', 'clients.id', 'projects.client_id')
      .where('projects.slack_team_id', '=', slackTeamId)
      .select([
        'projects.id',
        'projects.name',
        'projects.client_id',
        'clients.name as client_name',
        'projects.billable',
        'projects.archived_at',
      ])
      .orderBy('projects.created_at', 'desc')
      .orderBy('projects.id')
      .execute();
  }

  protected mapToViewModel = (row: SqlRow<'projects'>) => {
    return {
      id: row.id,
      name: row.name,
      status: row.status as ProjectStatus,
      billable: row.billable,
      hourly_rate: row.hourly_rate ?? null,
      description: row.description || '',
      slack_team_id: row.slack_team_id,
      client_id: row.client_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      archived_at: row.archived_at,
      archived_by: row.archived_by,
    };
  };
}
