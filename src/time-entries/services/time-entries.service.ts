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
import {
  BILLED_ENTRY_MESSAGE,
  isBilledEntryError,
} from 'src/time-entries/constants/billed-time-entries';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { getDateOnly } from '@common/utils/date.utils';

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

// What an entry takes from its project.
interface IEntryProject {
  id: string;
  client_id: string | null;
  billable: boolean;
}

// Who writes an entry.
type IEntryActor = Pick<IUserViewModel, 'id' | 'slack_team_id'>;

interface IWriteOptions {
  // Write only while the entry is a draft or rejected: the owner's rule, and
  // the timesheet's for everyone. Admin and HR otherwise change any entry.
  openOnly?: boolean;
}

interface IUpdateWriteOptions extends IWriteOptions {
  // The new project, when the changes move the entry to one.
  project?: IEntryProject;
}

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
  // The time logged from this vacation.
  vacationRequestId?: string;
  slackTeamId: string;
}

type ISearchTimeEntriesParams = ISearchParams<IFindParams>;

// What deleteVacationTime removed: how many entries, whose they were (the
// person who logged them, normally one) with their time and projects, and
// the days whose time stays because it is billed.
export interface IRemovedVacationTime {
  deleted: number;
  owners: { userId: string; minutes: number; projectIds: string[] }[];
  billedDates: string[];
}

@Injectable()
export class TimeEntriesService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly timeEntriesValidationService: TimeEntriesValidationService,
    private readonly projectsService: ProjectsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel> {
    const project = await this.getProject(createParams.projectId, user);

    await this.timeEntriesValidationService.validateCreate(createParams, user);

    const created = await this.insert(createParams, project, user);

    this.announceSubmitted([created], user);

    return created;
  }

  // Writes a new entry the caller has checked (create()). It takes its
  // client and billability from its project.
  private insert(
    params: ICreateParams,
    project: IEntryProject,
    actor: IEntryActor,
  ): Promise<ITimeEntryViewModel> {
    return this.timeEntriesRepository.create(
      this.newRow(params, project, actor),
    );
  }

  // Writes new entries the caller has checked (the timesheet) in one insert,
  // as insert() does one.
  public insertMany(
    entries: { params: ICreateParams; project: IEntryProject }[],
    actor: IEntryActor,
  ): Promise<ITimeEntryViewModel[]> {
    return this.timeEntriesRepository.createMany(
      entries.map(({ params, project }) => this.newRow(params, project, actor)),
    );
  }

  // The approved time of a vacation: `minutes` on each of `dates`, in one
  // insert. The caller has checked the person, the days and the project (no
  // owner or assignment check, which are for people logging their own time),
  // and takes care that no day gets two sets. Returns how many entries.
  public async createForVacation({
    userId,
    teamId,
    projectId,
    minutes,
    dates,
    vacationRequestId,
    description,
    slackTeamId,
  }: {
    userId: string;
    teamId: string | null;
    projectId: string;
    minutes: number;
    dates: string[];
    vacationRequestId: string;
    // Of every entry: what the time is (the leave type).
    description?: string;
    slackTeamId: string;
  }): Promise<number> {
    if (!dates.length) {
      return 0;
    }

    const project = await this.projectsService.findOne({
      id: projectId,
      slackTeamId,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const created = await this.timeEntriesRepository.createMany(
      dates.map((date) =>
        this.newRow(
          {
            userId,
            teamId,
            projectId,
            workDate: new Date(date),
            minutes,
            description,
            status: TimeEntryStatus.Approved,
          },
          project,
          { id: userId, slack_team_id: slackTeamId },
          vacationRequestId,
        ),
      ),
    );

    return created.length;
  }

  // The row of a new entry: its client and billability are its project's.
  private newRow(
    params: ICreateParams,
    project: IEntryProject,
    actor: IEntryActor,
    vacationRequestId: string | null = null,
  ) {
    const now = new Date().toISOString();

    return {
      user_id: params.userId,
      project_id: project.id,
      client_id: project.client_id,
      work_date: params.workDate.toISOString(),
      minutes: params.minutes,
      description: params.description || null,
      billable: project.billable,
      status: params.status,
      team_id: params.teamId,
      vacation_request_id: vacationRequestId,
      slack_team_id: actor.slack_team_id,
      created_at: now,
      updated_at: now,
      created_by: actor.id,
      updated_by: actor.id,
    };
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

    const updated = await this.answeringAsTheCheck(
      () => this.writeUpdate(existingEntry, updateParams, user, { project }),
      async () =>
        this.timeEntriesValidationService.validateUpdate(
          await this.findOneWithValidation({ id, slackTeamId }),
          updateParams,
          user,
        ),
    );

    if (existingEntry.status !== TimeEntryStatus.Submitted) {
      this.announceSubmitted([updated], user);
    }

    return updated;
  }

  // Writes `changes` to `entry`, which the caller read and checked, unless it
  // changed since: deleted, or no longer a draft or rejected when only such
  // an entry may change (`openOnly`, by default the owner's rule). Throws
  // TimeEntryChangedError then, and the billed message when a billing
  // snapshot took the entry.
  public async writeUpdate(
    entry: ITimeEntryViewModel,
    changes: IUpdateParams,
    actor: IUserViewModel,
    {
      project,
      openOnly = !isTimeEntriesAdmin(actor.role),
    }: IUpdateWriteOptions = {},
  ): Promise<ITimeEntryViewModel> {
    const [updated] = await this.refusingBilled(() =>
      this.timeEntriesRepository.updateMany(
        this.unchangedSinceCheck(entry, openOnly),
        {
          ...this.changedColumns(changes, actor),
          ...(project
            ? {
                project_id: project.id,
                client_id: project.client_id,
                billable: project.billable,
              }
            : {}),
        },
      ),
    );

    if (!updated) {
      throw new TimeEntryChangedError();
    }

    return updated;
  }

  // Gives entries the caller read and checked their new minutes (by ID), and
  // all of them `changes`, in one statement, as writeUpdate does one. Returns
  // the IDs it left alone because the entry changed since: the caller throws
  // and its transaction undoes the rest.
  public async writeMinutes(
    minutesById: Map<string, number>,
    changes: Pick<IUpdateParams, 'description' | 'status'>,
    actor: IUserViewModel,
    { openOnly = !isTimeEntriesAdmin(actor.role) }: IWriteOptions = {},
  ): Promise<string[]> {
    const written = new Set(
      await this.refusingBilled(() =>
        this.timeEntriesRepository.setMinutes(
          actor.slack_team_id,
          minutesById,
          this.changedColumns(changes, actor),
          openOnly ? OPEN_TIME_ENTRY_STATUSES : undefined,
        ),
      ),
    );

    return [...minutesById.keys()].filter((id) => !written.has(id));
  }

  // The columns an update writes.
  private changedColumns(changes: IUpdateParams, actor: IEntryActor) {
    return {
      ...(changes.userId !== undefined ? { user_id: changes.userId } : {}),
      ...(changes.teamId !== undefined ? { team_id: changes.teamId } : {}),
      ...(changes.workDate !== undefined
        ? { work_date: changes.workDate.toISOString() }
        : {}),
      ...(changes.minutes !== undefined ? { minutes: changes.minutes } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description }
        : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      // A changed entry is no longer the one that was rejected.
      ...(changes.status !== undefined &&
      changes.status !== TimeEntryStatus.Rejected
        ? { rejection_reason: null }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    };
  }

  // Deletes `entry` (keeping it as history), which the caller read and
  // checked, unless it changed since, as writeUpdate.
  public async writeDelete(
    entry: ITimeEntryViewModel,
    actor: IUserViewModel,
    options: IWriteOptions = {},
  ): Promise<void> {
    if ((await this.writeDeletes([entry], actor, options)).length) {
      throw new TimeEntryChangedError();
    }
  }

  // Deletes entries the caller read and checked (keeping them as history) in
  // one statement, as writeDelete does one. Returns the IDs it left alone
  // because the entry changed since.
  public async writeDeletes(
    entries: ITimeEntryViewModel[],
    actor: IUserViewModel,
    { openOnly = !isTimeEntriesAdmin(actor.role) }: IWriteOptions = {},
  ): Promise<string[]> {
    if (!entries.length) {
      return [];
    }

    const ids = entries.map(({ id }) => id);
    const deleted = await this.refusingBilled(() =>
      this.timeEntriesRepository.updateMany(
        {
          id: { operator: 'in', value: ids },
          slack_team_id: actor.slack_team_id,
          deleted_at: { operator: 'is', value: null },
          ...(openOnly
            ? { status: { operator: 'in', value: OPEN_TIME_ENTRY_STATUSES } }
            : {}),
        },
        {
          deleted_at: new Date().toISOString(),
          deleted_by: actor.id,
        },
      ),
    );
    const written = new Set(deleted.map(({ id }) => id));

    return ids.filter((id) => !written.has(id));
  }

  // Deletes the time logged from a vacation (keeping it as history) when the
  // vacation changes, in the caller's transaction, in one statement. Entries
  // in a billing snapshot can't change and stay; their days are returned,
  // sorted, so the person who changed the vacation hears of them.
  public async deleteVacationTime(
    requestId: string,
    slackTeamId: string,
    user: IUserViewModel,
  ): Promise<IRemovedVacationTime> {
    const { deleted, billedDates } = await this.refusingBilled(() =>
      this.timeEntriesRepository.deleteVacationTime(
        slackTeamId,
        requestId,
        user.id,
      ),
    );

    const owners = new Map<string, { minutes: number; projectIds: string[] }>();

    for (const { user_id, minutes, project_id } of deleted) {
      const owner = owners.get(user_id) ?? { minutes: 0, projectIds: [] };

      owners.set(user_id, {
        minutes: owner.minutes + minutes,
        projectIds: [...new Set([...owner.projectIds, project_id])],
      });
    }

    return {
      deleted: deleted.length,
      owners: [...owners].map(([userId, owner]) => ({ userId, ...owner })),
      billedDates: [...new Set(billedDates.map(getDateOnly))].sort(),
    };
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
    {
      id,
      slackTeamId,
      dateFrom,
      dateTo,
    }: {
      id?: string;
      slackTeamId: string;
      // Only the entries worked between these days (a week).
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

    this.announceSubmitted(submitted, user);

    return submitted;
  }

  // Entries that just went to their approvers: submitted by their owner, or
  // logged or set as submitted by Admin or HR. The approvers hear of them.
  private announceSubmitted(
    entries: ITimeEntryViewModel[],
    submittedBy: IUserViewModel,
  ) {
    const submitted = entries.filter(
      ({ status }) => status === TimeEntryStatus.Submitted,
    );

    if (submitted.length) {
      this.eventEmitter.emit(
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

  // The user's entries between two days, cancelled ones included, without
  // their relations, and which of them are billed: in one query.
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
      () => this.writeDelete(entry, user),
      async () =>
        this.timeEntriesValidationService.validateDelete(
          await this.findOneWithValidation(params),
          user,
        ),
    );

    return entry;
  }

  // The entry as the caller checked it: not deleted, and still a draft or
  // rejected when `openOnly`.
  private unchangedSinceCheck(
    entry: ITimeEntryViewModel,
    openOnly: boolean,
  ): RepositoryFilter {
    return {
      id: entry.id,
      slack_team_id: entry.slack_team_id,
      deleted_at: { operator: 'is', value: null },
      ...(openOnly
        ? { status: { operator: 'in', value: OPEN_TIME_ENTRY_STATUSES } }
        : {}),
    };
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

  // A snapshot can take the entry between the check and the write; the
  // database then refuses the write (time_entries_keep_billed).
  private async refusingBilled<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isBilledEntryError(error)) {
        throw new ValidationError(BILLED_ENTRY_MESSAGE);
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
