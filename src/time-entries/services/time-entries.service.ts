import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { SupabaseFilter } from '@common/repositories/base.repository';
import ProjectsService from 'src/projects/services/projects.service';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { ValidationError } from '@common/errors/validation.error';
import {
  isOpenTimeEntry,
  OPEN_TIME_ENTRY_STATUSES,
} from 'src/time-entries/constants/open-time-entry-statuses';

interface ICreateParams {
  userId: string;
  // The team of the user the time is logged for.
  teamId: string | null;
  projectId: string;
  workDate: Date;
  minutes: number;
  description?: string | null;
  status: TimeEntryStatus;
}

interface IUpdateParams {
  userId?: string;
  teamId?: string | null;
  projectId?: string;
  workDate?: Date;
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
  // The entries of these teams; an empty list matches none.
  teamIds?: string[];
  slackTeamId: string;
}

type ISearchTimeEntriesParams = ISearchParams<IFindParams>;

@Injectable()
export class TimeEntriesService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly timeEntriesValidationService: TimeEntriesValidationService,
    private readonly projectsService: ProjectsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
  ) {}

  public async create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const project = await this.getProject(createParams.projectId, user);

    await this.timeEntriesValidationService.validateCreate(createParams, user);

    const now = new Date().toISOString();

    const record = {
      user_id: createParams.userId,
      project_id: project.id,
      client_id: project.client_id,
      work_date: createParams.workDate.toISOString(),
      minutes: createParams.minutes,
      description: createParams.description || null,
      billable: project.billable,
      status: createParams.status,
      team_id: createParams.teamId,
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

    // An entry keeps its project even after its owner left the project; a new
    // project has to be one they may log time on.
    const project =
      updateParams.projectId !== undefined
        ? await this.getProject(updateParams.projectId, user, {
            isNewProject: updateParams.projectId !== existingEntry.project_id,
          })
        : undefined;

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
        ...(updateParams.teamId !== undefined
          ? { team_id: updateParams.teamId }
          : {}),
        ...(project
          ? {
              project_id: project.id,
              client_id: project.client_id,
              billable: project.billable,
            }
          : {}),
        ...(updateParams.workDate !== undefined
          ? {
              work_date: updateParams.workDate.toISOString(),
            }
          : {}),
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

  public findOne(params: IFindParams): Promise<ITimeEntryViewModel | null> {
    return this.timeEntriesRepository.findOne(this.getFindQuery(params));
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
    return this.timeEntriesRepository.findMany(this.getFindQuery(params));
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

  // Sends the user's own entry `id`, or all their drafts and rejected entries,
  // for approval.
  public async submit(
    { id, slackTeamId }: { id?: string; slackTeamId: string },
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel[]> {
    if (id) {
      const entry = await this.findOneWithValidation({ id, slackTeamId });

      if (entry.user_id !== user.id) {
        throw new ForbiddenException(
          'You can only submit your own time entries',
        );
      }

      if (!isOpenTimeEntry(entry.status)) {
        throw new ValidationError('This time entry has already been submitted');
      }
    }

    return this.timeEntriesRepository.updateMany(
      this.getFindQuery({
        id,
        userId: user.id,
        slackTeamId,
        statuses: OPEN_TIME_ENTRY_STATUSES,
      }),
      {
        status: TimeEntryStatus.Submitted,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
    );
  }

  public count(params: IFindParams): Promise<number> {
    return this.timeEntriesRepository.count(this.getFindQuery(params));
  }

  public async delete(
    params: IFindParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const entry = await this.findOneWithValidation(params);

    this.timeEntriesValidationService.validateDelete(entry, user);

    await this.timeEntriesRepository.update(
      { id: entry.id, slack_team_id: entry.slack_team_id },
      {
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      },
    );

    return entry;
  }

  // An entry takes its client and billability from its project, which has to
  // be an active project of the workspace. Admin and HR log time on any of
  // them, everyone else only on their team's and their own projects (the
  // project ID comes from the form).
  private async getProject(
    projectId: string,
    actor: IUserViewModel,
    { isNewProject = true }: { isNewProject?: boolean } = {},
  ) {
    const project = await this.projectsService.findOne({
      id: projectId,
      slackTeamId: actor.slack_team_id,
    });
    const mayLogOn =
      !isNewProject ||
      isTimeEntriesAdmin(actor.role) ||
      (
        await this.getUserProjectsQuery.execute({
          userId: actor.id,
          slackTeamId: actor.slack_team_id,
        })
      ).some(({ id }) => id === projectId);

    if (!project || !mayLogOn) {
      throw new ValidationError('This project is not available.');
    }

    return project;
  }

  // Deleted entries are kept, but only as history.
  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      deleted_at: { operator: 'is', value: null },
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
      ...(params.teamIds
        ? { team_id: { operator: 'in', value: params.teamIds } }
        : {}),
      ...(params.dateFrom || params.dateTo
        ? {
            work_date: [
              ...(params.dateFrom
                ? [{ operator: 'gte' as const, value: params.dateFrom }]
                : []),
              ...(params.dateTo
                ? [{ operator: 'lte' as const, value: params.dateTo }]
                : []),
            ],
          }
        : {}),
      slack_team_id: params.slackTeamId,
    };
  }
}
