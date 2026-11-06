import { Injectable } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

interface ISearchProjectsParams {
  query: string;
  user: IUserViewModel;
  includeArchived?: boolean;
}

interface ISearchProjectsOptions {
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;

@Injectable()
export class ProjectOptionsService {
  public constructor(private readonly projectsService: ProjectsService) {}

  public async searchProjects(
    { query, user, includeArchived = false }: ISearchProjectsParams,
    { pageSize = DEFAULT_PAGE_SIZE }: ISearchProjectsOptions = {},
  ) {
    const result = await this.projectsService.search({
      searchTerm: query,
      pageSize,
      filters: {
        slackTeamId: user.slack_team_id,
        includeArchived,
      },
    });

    return {
      options: result.items.map((project) => ({
        text: { type: 'plain_text', text: `${project.name}${project.archived_at ? ' (Archived)' : ''}` },
        value: project.id,
      })),
    };
  }
}
