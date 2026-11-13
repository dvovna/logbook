import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TIME_ENTRIES_SUBMITTED,
  TimeEntriesSubmittedEvent,
} from 'src/time-entries/events/time-entries.events';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { RepositoryFilter } from '@common/repositories/repository.types';
import ProjectsService from 'src/projects/services/projects.service';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { ValidationError } from '@common/errors/validation.error';
import {
  isOpenTimeEntry,
  OPEN_TIME_ENTRY_STATUSES,
} from 'src/time-entries/constants/open-time-entry-statuses';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import {
  ITimeEntryCreateParams,
  ITimeEntryUpdateParams,
} from 'src/time-entries/types/time-entry-writes.types';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import {
  IReportEntriesQuery,
  TimeReportCsvCursor,
} from 'src/time-entries/types/time-report.types';
import { TransactionService } from 'src/database/transaction.service';

interface IFindParams {
  id?: string;
  // These entries only; an empty list matches none.
  ids?: string[];
  userId?: string;
  // The entries of these people; an empty list matches none.
  userIds?: string[];
  billable?: boolean;
  projectId?: string;
  projectIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  statuses?: TimeEntryStatus[];
  // The entries of these teams; an empty list matches none.
  teamIds?: string[];
  vacationRequestId?: string;
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
    private readonly eventEmitter: EventEmitter2,
    private readonly timeEntryWriter: TimeEntryWriter,
    private readonly transactions: TransactionService,
  ) {}

  public async create(
    createParams: ITimeEntryCreateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const project = await this.getProject(createParams.projectId, user);

    await this.timeEntriesValidationService.validateCreate(createParams, user);

    return this.submitting(createParams.status, async () => {
      const created = await this.timeEntryWriter.insert(
        createParams,
        project,
        user,
      );

      await this.announceSubmitted([created], user);

      return created;
    });
  }

  public async update(
    { id, slackTeamId }: IFindParams,
    params: ITimeEntryUpdateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const existingEntry = await this.findOneWithValidation({
      id,
      slackTeamId,
    });
    // An entry counts for the team it was logged in (who approves it, whose
    // reports hold it), wherever its person is now; only an entry moved to
    // someone else takes that person's team.
    const movesToSomeoneElse =
      params.userId !== undefined && params.userId !== existingEntry.user_id;
    const updateParams = movesToSomeoneElse
      ? params
      : { ...params, teamId: undefined };

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

    return this.submitting(updateParams.status, async () => {
      const updated = await this.answeringAsTheCheck(
        () =>
          this.timeEntryWriter.writeUpdate(existingEntry, updateParams, user, {
            project,
          }),
        async () =>
          this.timeEntriesValidationService.validateUpdate(
            await this.findOneWithValidation({ id, slackTeamId }),
            updateParams,
            user,
          ),
      );

      if (existingEntry.status !== TimeEntryStatus.Submitted) {
        await this.announceSubmitted([updated], user);
      }

      return updated;
    });
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

  public sumMinutes({
    slackTeamId,
    ...params
  }: {
    slackTeamId: string;
    dateFrom: string;
    dateTo: string;
    userId?: string;
    teamIds?: string[];
  }) {
    return this.timeEntriesRepository.sumMinutes(slackTeamId, params);
  }

  public sumReportGroups(
    slackTeamId: string,
    query: IReportEntriesQuery,
    groupBy: TimeReportGrouping,
  ) {
    return this.timeEntriesRepository.sumReportGroups(
      slackTeamId,
      query,
      groupBy,
    );
  }

  public findReportCsvPage(
    slackTeamId: string,
    query: IReportEntriesQuery,
    page: { after?: TimeReportCsvCursor; limit: number; withRates: boolean },
  ) {
    return this.timeEntriesRepository.findReportCsvPage(
      slackTeamId,
      query,
      page,
    );
  }

  public sumOfUsers({
    slackTeamId,
    userIds,
    ...period
  }: {
    slackTeamId: string;
    userIds: string[];
    dateFrom: string;
    dateTo: string;
  }) {
    return this.timeEntriesRepository.sumOfUsers(slackTeamId, userIds, period);
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
    {
      id,
      slackTeamId,
      dateFrom,
      dateTo,
    }: {
      id?: string;
      slackTeamId: string;
      dateFrom?: string;
      dateTo?: string;
    },
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

    return this.transactions.transaction(async () => {
      const submitted = await this.timeEntriesRepository.updateMany(
        this.getFindQuery({
          id,
          userId: user.id,
          slackTeamId,
          dateFrom,
          dateTo,
          statuses: OPEN_TIME_ENTRY_STATUSES,
        }),
        {
          status: TimeEntryStatus.Submitted,
          rejection_reason: null,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        },
      );

      await this.announceSubmitted(submitted, user);

      return submitted;
    });
  }

  // A write that may submit an entry runs in a transaction with the jobs
  // that tell its approvers (announceSubmitted); any other needs none.
  private submitting<T>(
    status: TimeEntryStatus | undefined,
    write: () => Promise<T>,
  ): Promise<T> {
    return status === TimeEntryStatus.Submitted
      ? this.transactions.transaction(write)
      : write();
  }

  // Entries that just went to their approvers: submitted by their owner, or
  // logged or set as submitted by Admin or HR. The approvers hear of them:
  // the listener saves the jobs in the caller's transaction (emitAsync).
  private async announceSubmitted(
    entries: ITimeEntryViewModel[],
    submittedBy: IUserViewModel,
  ) {
    const submitted = entries.filter(
      ({ status }) => status === TimeEntryStatus.Submitted,
    );

    if (submitted.length) {
      await this.eventEmitter.emitAsync(
        TIME_ENTRIES_SUBMITTED,
        new TimeEntriesSubmittedEvent(
          submitted,
          submitted[0].slack_team_id,
          submittedBy.id,
        ),
      );
    }
  }

  // Which of the entries are in a billing snapshot (locked).
  public findBilledIds(slackTeamId: string, ids: string[]) {
    return this.timeEntriesRepository.findBilledIds(slackTeamId, ids);
  }

  public findOfUserWithBilled(params: {
    userId: string;
    slackTeamId: string;
    dateFrom: string;
    dateTo: string;
  }) {
    return this.timeEntriesRepository.findOfUserWithBilled(
      params.slackTeamId,
      params,
    );
  }

  public countOpenUpTo(params: {
    userId: string;
    slackTeamId: string;
    dateTo: string;
  }) {
    return this.timeEntriesRepository.countOpenUpTo(
      params.slackTeamId,
      params.userId,
      params.dateTo,
    );
  }

  public findUserIdsWithOpenUpTo(params: {
    slackTeamId: string;
    dateTo: string;
    reminders: TimeReminder[];
  }): Promise<string[]> {
    return this.timeEntriesRepository.findUserIdsWithOpenUpTo(
      params.slackTeamId,
      params.dateTo,
      params.reminders,
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

    await this.timeEntriesValidationService.validateDelete(entry, user);

    await this.answeringAsTheCheck(
      () => this.timeEntryWriter.writeDelete(entry, user),
      async () =>
        this.timeEntriesValidationService.validateDelete(
          await this.findOneWithValidation(params),
          user,
        ),
    );

    return entry;
  }

  // A write refused because the entry changed after its check answers as
  // the check does now ("Submitted time entries cannot be edited", not found
  // once deleted).
  private async answeringAsTheCheck<T>(
    write: () => Promise<T>,
    check: () => Promise<unknown>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof TimeEntryChangedError) {
        await check();
      }

      throw error;
    }
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
      throw new ValidationError('This project is not available.', 'project');
    }

    return project;
  }

  // Deleted entries are kept, but only as history.
  private getFindQuery(params: IFindParams): RepositoryFilter {
    return {
      deleted_at: { operator: 'is', value: null },
      ...(params.id ? { id: params.id } : {}),
      ...(params.ids ? { id: { operator: 'in', value: params.ids } } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.userIds
        ? { user_id: { operator: 'in', value: params.userIds } }
        : {}),
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
      ...(params.vacationRequestId
        ? { vacation_request_id: params.vacationRequestId }
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
