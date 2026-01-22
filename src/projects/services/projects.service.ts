import { IUserViewModel } from '@modules/users/types/user.interface';
import { Injectable, NotFoundException } from '@nestjs/common';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import {
  ISearchParams,
  ISearchResult,
} from '@common/types/pagination.types';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { ProjectsRepository } from 'src/projects/repositories/projects.repository';
import IProjectViewModel from 'src/projects/types/project.types';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import CatchDuplicatedRecord from '@common/decorators/catch-duplicated-record';

interface ICreateProjectParams {
  name: string;
  billable: boolean;
  status: ProjectStatus;
  description?: string;
  slackTeamId: string;
  clientId?: string;
}

interface IFindParams {
  id?: string;
  name?: string;
  slackTeamId: string;
  clientId?: string;
  includeArchived?: boolean;
}

interface IUpdateParams {
  name?: string;
  clientId?: string;
  description?: string;
  billable?: boolean;
  status?: ProjectStatus;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

type ISearchClientsParams = ISearchParams<IFindParams>;

interface IProjectsService {
  create(
    createParams: ICreateProjectParams,
    user: IUserViewModel,
  ): Promise<IProjectViewModel>;
  findMany(params: IFindParams): Promise<IProjectViewModel[]>;
  findOne(params: IFindParams): Promise<IProjectViewModel | null>;
  findOneWithValidation(params: IFindParams): Promise<IProjectViewModel>;
  search(params: ISearchClientsParams): Promise<ISearchResult<IProjectViewModel>>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IProjectViewModel>;
  archive(clientId: string, user: IUserViewModel): Promise<IProjectViewModel>;
  count(params: IFindParams): Promise<number>;
}

const CatchDuplicatedProject = CatchDuplicatedRecord('Project with same name already exists.');

@Injectable()
export default class ProjectsService implements IProjectsService {
  public constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly config: ConfigService,
  ) {}

  public async findMany(params: IFindParams) {
    return this.projectsRepository.findMany(this.getFindQuery(params));
  }

  public async findOne(params: IFindParams) {
    return this.projectsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(params: IFindParams) {
    const project = await this.projectsRepository.findOne(this.getFindQuery(params));

    if (!project) {
      throw new NotFoundException(`Project with id ${params.id} not found.`);
    }

    return project;
  }

  public async search(params: ISearchClientsParams) {
    return this.projectsRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  @CatchDuplicatedProject
  public async create(createParams: ICreateProjectParams, user: IUserViewModel) {
    const projectsCount = await this.projectsRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    const maxProjectsCount = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxProjectsPerSlackTeam,
    );

    if (projectsCount >= maxProjectsCount) {
      throw new MaxItemsCountReachedError(maxProjectsCount, 'projects');
    }

    const createdAt = new Date().toISOString();

    return await this.projectsRepository.create({
      name: createParams.name,
      description: createParams.description || '',
      billable: createParams.billable,
      status: createParams.status,
      slack_team_id: createParams.slackTeamId,
      client_id: createParams.clientId || null,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: user.id,
      updated_by: user.id,
      archived_by: null,
    });
  }

  @CatchDuplicatedProject
  public async update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ) {
    return this.projectsRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.description
        ? { description: updateParams.description }
        : {}),
      ...(updateParams.clientId ? { clientId: updateParams.clientId } : {}),
      ...(updateParams.status ? { status: updateParams.status } : {}),
      ...(updateParams.billable !== undefined ? { billable: updateParams.billable } : {}),
      ...(updateParams.archivedAt !== undefined
        ? { archived_at: updateParams.archivedAt }
        : {}),
      ...(updateParams.archivedBy || updateParams.archivedAt !== undefined
        ? { archived_by: updateParams.archivedBy || user.id }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  }

  public async archive(projectId: string, user: IUserViewModel) {
    const project = await this.findOneWithValidation({
      id: projectId,
      slackTeamId: user.slack_team_id,
    });

    await this.projectsRepository.update({
      id: projectId,
      slack_team_id: user.slack_team_id,
    }, {
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });

    return project;
  }

  public count(params: IFindParams) {
    return this.projectsRepository.count(this.getFindQuery(params));
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.name ? { name: params.name } : {}),
      ...(params.slackTeamId ? { slack_team_id: params.slackTeamId } : {}),
      ...(params.clientId ? { client_id: params.clientId } : {}),
      archived_at: params.includeArchived ? undefined : { operator: 'is', value: null },
    };
  }
}
