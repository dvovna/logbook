import { IUserViewModel } from '@modules/users/types/user.interface';
import { Injectable, NotFoundException } from '@nestjs/common';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { ClientsRepository } from '@modules/clients/repositories/clients.repository';
import IClientViewModel from '@modules/clients/types/client.interface';
import CatchDuplicatedRecord from '@common/decorators/catch-duplicated-record';

interface ICreateClientParams {
  name: string;
  description?: string;
  slackTeamId: string;
}

interface IFindParams {
  id?: string;
  name?: string;
  slackTeamId: string;
  includeArchived?: boolean;
}

interface IUpdateParams {
  name?: string;
  description?: string;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

type ISearchClientsParams = ISearchParams<IFindParams>;

interface IClientsService {
  create(
    createParams: ICreateClientParams,
    user: IUserViewModel,
  ): Promise<IClientViewModel>;
  findMany(params: IFindParams): Promise<IClientViewModel[]>;
  findOne(params: IFindParams): Promise<IClientViewModel | null>;
  findOneWithValidation(params: IFindParams): Promise<IClientViewModel>;
  search(
    params: ISearchClientsParams,
  ): Promise<ISearchResult<IClientViewModel>>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IClientViewModel>;
  delete(clientId: string, user: IUserViewModel): Promise<IClientViewModel>;
  count(params: IFindParams): Promise<number>;
}

const CatchDuplicatedClient = CatchDuplicatedRecord(
  'Client with same name already exists.',
);

@Injectable()
export default class ClientsService implements IClientsService {
  public constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly config: ConfigService,
  ) {}

  public async findMany(params: IFindParams) {
    return this.clientsRepository.findMany(this.getFindQuery(params));
  }

  public async findOne(params: IFindParams) {
    return this.clientsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(params: IFindParams) {
    const client = await this.clientsRepository.findOne(
      this.getFindQuery(params),
    );

    if (!client) {
      throw new NotFoundException(`Client with id ${params.id} not found`);
    }

    return client;
  }

  public async search(params: ISearchClientsParams) {
    return this.clientsRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  @CatchDuplicatedClient
  public async create(createParams: ICreateClientParams, user: IUserViewModel) {
    const clientsCount = await this.clientsRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    const maxClientsCount = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxClientsPerSlackTeam,
    );

    if (clientsCount >= maxClientsCount) {
      throw new MaxItemsCountReachedError(maxClientsCount, 'clients');
    }

    const createdAt = new Date().toISOString();

    return await this.clientsRepository.create({
      name: createParams.name,
      description: createParams.description || '',
      slack_team_id: createParams.slackTeamId,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: user.id,
      updated_by: user.id,
      archived_by: null,
    });
  }

  @CatchDuplicatedClient
  public update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ) {
    return this.clientsRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.description
        ? { description: updateParams.description }
        : {}),
      ...(updateParams.archivedAt !== undefined
        ? { archived_at: updateParams.archivedAt }
        : {}),
      ...(updateParams.archivedBy !== undefined
        ? { archived_by: updateParams.archivedBy }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  }

  public async delete(clientId: string, user: IUserViewModel) {
    const client = await this.findOneWithValidation({
      id: clientId,
      slackTeamId: user.slack_team_id,
    });

    await this.clientsRepository.deleteMany({
      id: clientId,
      slack_team_id: user.slack_team_id,
    });

    return client;
  }

  public count(params: IFindParams) {
    return this.clientsRepository.count(this.getFindQuery(params));
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      slack_team_id: params.slackTeamId,
      archived_at: params.includeArchived
        ? undefined
        : { operator: 'is', value: null },
      ...(params.id ? { id: params.id } : {}),
      ...(params.name ? { name: params.name } : {}),
    };
  }
}
