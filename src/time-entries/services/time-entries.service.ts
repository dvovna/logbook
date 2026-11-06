import { Injectable, NotFoundException } from '@nestjs/common';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { SupabaseFilter } from '@common/repositories/base.repository';

interface ICreateParams {
  userId: string;
  clientId?: string;
  projectId: string;
  billable: boolean;
  workDate: Date;
  minutes: number;
  description?: string | null;
  status: TimeEntryStatus;
}

interface IUpdateParams {
  userId?: string;
  projectId?: string;
  workDate?: Date;
  billable?: boolean;
  minutes?: number;
  description?: string | null;
  status?: TimeEntryStatus;
}

interface IFindParams {
  id?: string;
  userId?: string;
  billable?: boolean;
  projectId?: string;
  projectIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  statuses?: TimeEntryStatus[];
  slackTeamId?: string;
}

type ISearchTimeEntriesParams = ISearchParams<IFindParams>;

@Injectable()
export class TimeEntriesService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly timeEntriesValidationService: TimeEntriesValidationService,
  ) {}

  public async create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    await this.timeEntriesValidationService.validateCreate(
      createParams,
      user,
    );

    const now = new Date().toISOString();

    const record = {
      user_id: createParams.userId,
      project_id: createParams.projectId,
      client_id: createParams.clientId,
      work_date: createParams.workDate.toISOString(),
      minutes: createParams.minutes,
      description: createParams.description || null,
      billable: createParams.billable,
      status: createParams.status,
      team_id: user.team_id,
      slack_team_id: user.slack_team_id,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    };

    return await this.timeEntriesRepository.create(record);
  }

  public async update(
    { id, slackTeamId }: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const existingEntry = await this.findOneWithValidation({
      id,
      slackTeamId,
    });

    await this.timeEntriesValidationService.validateUpdate(
      existingEntry,
      updateParams,
      user,
    );

    return await this.timeEntriesRepository.update(
      {
        id,
        slack_team_id: slackTeamId,
      },
      {
        ...(updateParams.userId !== undefined
          ? { user_id: updateParams.userId }
          : {}),
        ...(updateParams.projectId !== undefined
          ? { project_id: updateParams.projectId }
          : {}),
        ...(updateParams.workDate !== undefined
          ? {
            work_date:
              updateParams.workDate.toISOString(),
          }
          : {}),
        ...(updateParams.billable !== undefined
          ? { billable: updateParams.billable }
          : {}
        ),
        ...(updateParams.minutes !== undefined
          ? { minutes: updateParams.minutes }
          : {}),
        ...(updateParams.description !== undefined
          ? { description: updateParams.description }
          : {}),
        ...(updateParams.status !== undefined
          ? { status: updateParams.status }
          : {}),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
    );
  }

  public findOne(
    params: IFindParams,
  ): Promise<ITimeEntryViewModel | null> {
    return this.timeEntriesRepository.findOne(
      this.getFindQuery(params),
    );
  }

  public async findOneWithValidation(
    params: IFindParams,
  ): Promise<ITimeEntryViewModel> {
    const entry = await this.findOne(params);

    if (!entry) {
      throw new NotFoundException('Time Entry not found');
    }

    return entry;
  }

  public async findMany(params: IFindParams) {
    return this.timeEntriesRepository.findMany(
      this.getFindQuery(params),
    );
  }

  public async search(
    params: ISearchTimeEntriesParams,
  ): Promise<ISearchResult<ITimeEntryViewModel>> {
    return this.timeEntriesRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  public async delete(
    params: IFindParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const entry = await this.findOneWithValidation(params);

    await this.timeEntriesRepository.update(
      { id: entry.id },
      {
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      },
    );

    return entry;
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.projectId ? { project_id: params.projectId } : {}),
      ...(params.billable !== undefined ? { billable: params.billable } : {}),
      ...(params.projectIds?.length
        ? { project_id: { operator: 'in', value: params.projectIds } }
        : {}),
      ...(params.statuses?.length
        ? { status: { operator: 'in', value: params.statuses } }
        : {}),
      ...(params.dateFrom
        ? { work_date: { operator: 'gte', value: params.dateFrom } }
        : {}),
      ...(params.dateTo
        ? { work_date: { operator: 'lte', value: params.dateTo } }
        : {}),
      ...(params.slackTeamId
        ? { slack_team_id: params.slackTeamId }
        : {}),
    };
  }
}
