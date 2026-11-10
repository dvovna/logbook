import { Injectable } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
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
  public constructor(
    private readonly projectsService: ProjectsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
  ) {}

  // The projects the user logs time on (their team's and their own ones,
  // archived included) whose name contains `query`.
  public async searchUserProjects({ query, user }: ISearchProjectsParams) {
    const projects = await this.getUserProjectsQuery.execute({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });
    const search = (query ?? '').toLowerCase();

    return {
      options: projects
        .filter(({ name }) => name.toLowerCase().includes(search))
        .slice(0, DEFAULT_PAGE_SIZE)
        .map((project) => ({
          text: { type: 'plain_text', text: project.name },
          value: project.id,
        })),
    };
  }

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
        text: {
          type: 'plain_text',
          text: `${project.name}${project.archived_at ? ' (Archived)' : ''}`,
        },
        value: project.id,
      })),
    };
  }
}
