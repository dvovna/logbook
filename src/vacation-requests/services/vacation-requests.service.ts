import { vacationRequestLock } from 'src/database/advisory-locks';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import { TransactionService } from 'src/database/transaction.service';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  VacationRequestsValidationService,
  ACTIVE_REQUEST_STATUSES,
} from '@modules/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { vacationPolicyOfTeam } from '@modules/teams/utils/team-rules.utils';
import { UsersService } from '@modules/users/services/users.service';
import { getDateOnly } from '@common/utils/date.utils';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { ValidationError } from '@common/errors/validation.error';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isPeopleAdmin } from '@modules/users/utils/people-admin-roles';
import {
  assertCommentForOther,
  assertCommentLength,
  assertDatesInOrder,
  assertVacationType,
} from '@modules/vacation-requests/utils/vacation-request-input.utils';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import {
  IVacationRequestCreateParams,
  IVacationRequestFindParams,
  IVacationRequestUpdate,
  IVacationRequestUpdateParams,
} from '@modules/vacation-requests/types/vacation-request-params.types';

type ISearchRequestsParams = ISearchParams<IVacationRequestFindParams>;

// The vacations of one user for replaceVacations.
export interface IVacationsReplacement {
  user: IUserViewModel;
  vacations: IVacationRequestCreateParams[];
  // Set in the same transaction.
  contractStartDate?: Date;
}

// Rows per insert: a statement takes at most 65535 parameters, and a
// vacation row has at most 15.
const INSERT_CHUNK_ROWS = 2000;

// The value of a read started beside others, or its error.
const settled = <T>(result: PromiseSettledResult<T>): T => {
  if (result.status === 'rejected') {
    throw result.reason;
  }

  return result.value;
};

interface IVacationRequestsService {
  create(
    createParams: IVacationRequestCreateParams,
    user: IUserViewModel,
  ): Promise<IVacationRequestViewModel>;
  findOneWithValidation(
    findParams: IVacationRequestFindParams,
  ): Promise<IVacationRequestViewModel>;
  findMany(
    findParams: IVacationRequestFindParams,
  ): Promise<IVacationRequestViewModel[]>;
  search(
    searchParams: ISearchRequestsParams,
  ): Promise<ISearchResult<IVacationRequestViewModel>>;
  replaceUserVacations(
    user: IUserViewModel,
    vacations: IVacationRequestCreateParams[],
    replacedBy: IUserViewModel,
  ): Promise<IVacationRequestViewModel[]>;
}

@Injectable()
export class VacationRequestsService implements IVacationRequestsService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly vacationRequestsValidator: VacationRequestsValidationService,
    private readonly workingDaysCalculationService: VacationDaysCalculationService,
    private readonly teamRulesService: TeamRulesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly usersService: UsersService,
    private readonly transactions: TransactionService,
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {}

  public async create(
    createParams: IVacationRequestCreateParams,
    user: IUserViewModel,
  ) {
    const { userId, teamId, startDate, endDate, type } = createParams;

    this.assertCanCreate(createParams, user);
    assertDatesInOrder(startDate, endDate);
    assertVacationType(type);
    assertCommentLength(createParams.userComment);
    assertCommentForOther(type, createParams.userComment);

    await this.vacationRequestsValidator.validateRequestLimits(
      userId,
      user.slack_team_id,
    );

    if (ACTIVE_REQUEST_STATUSES.includes(createParams.status)) {
      await this.vacationRequestsValidator.validateNoOverlap({
        userId,
        slackTeamId: user.slack_team_id,
        startDate,
        endDate,
      });
    }

    const workingDates = await this.findWorkingDates(
      startDate,
      endDate,
      teamId,
      user,
    );
    const workingDays = workingDates.length;

    const calendarDays = getDaysBetweenDates(
      createParams.startDate,
      createParams.endDate,
    );

    // HR may record a rejected or canceled request, which uses no days.
    if (ACTIVE_REQUEST_STATUSES.includes(createParams.status)) {
      await this.vacationRequestsValidator.validateDaysRequested(
        { startDate, endDate, workingDates },
        type,
        await this.getRequestOwner(userId, user),
      );
    }

    const now = new Date().toISOString();
    const vacationRecord = {
      user_id: createParams.userId,
      team_id: createParams.teamId,
      start_date: createParams.startDate.toISOString(),
      end_date: createParams.endDate.toISOString(),
      days: calendarDays,
      working_days: workingDays,
      type,
      status: createParams.status,
      user_comment: createParams.userComment || null,
      slack_team_id: user.slack_team_id,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    };

    // The listeners save the jobs that follow a new request (its approval,
    // an offer to log it as time) in its transaction: emitAsync.
    return this.transactions.transaction(async () => {
      const request =
        await this.vacationRequestsRepository.create(vacationRecord);

      await this.eventEmitter.emitAsync(
        VacationRequestEvent.Created,
        new VacationRequestCreatedEvent(request, user),
      );

      return request;
    });
  }

  // Checks an edit and writes nothing: applyUpdate writes what passed.
  // What the checks read is read at once where it can be (the request and
  // its person, then their team, the overlaps and the balance, then the
  // team's holidays), and checked in the order below.
  public async checkUpdate(
    { id, slackTeamId }: IVacationRequestFindParams,
    updateParams: IVacationRequestUpdateParams,
    user: IUserViewModel,
  ): Promise<IVacationRequestUpdate> {
    const [existingRequest, chosenOwner] = await Promise.all([
      this.findOneWithValidation({ id, slackTeamId }),
      updateParams.userId !== undefined
        ? this.getRequestOwner(updateParams.userId, user)
        : null,
    ]);

    const {
      startDate = new Date(existingRequest.start_date),
      endDate = new Date(existingRequest.end_date),
      type = existingRequest.type,
      userComment,
      status,
      userId,
    } = updateParams;
    const teamId = chosenOwner?.team_id;

    // Only what changes is checked: a cancel must work on a request whose
    // old comment wouldn't pass today.
    if (updateParams.startDate || updateParams.endDate) {
      assertDatesInOrder(startDate, endDate);
    }

    if (updateParams.type !== undefined) {
      assertVacationType(type);
    }

    assertCommentLength(userComment);

    if (updateParams.type !== undefined || userComment !== undefined) {
      assertCommentForOther(
        type,
        userComment !== undefined ? userComment : existingRequest.user_comment,
      );
    }

    const calendarDays = getDaysBetweenDates(startDate, endDate);
    const hasDatesChanged =
      (updateParams.startDate &&
        getDateOnly(updateParams.startDate) !== existingRequest.start_date) ||
      (updateParams.endDate &&
        getDateOnly(updateParams.endDate) !== existingRequest.end_date);

    const finalStatus = status ?? existingRequest.status;
    const isStatusChanged =
      status !== undefined && status !== existingRequest.status;
    const isUserChanged =
      userId !== undefined && userId !== existingRequest.user_id;
    const isTypeChanged =
      updateParams.type !== undefined && type !== existingRequest.type;
    const userTeamId = teamId || existingRequest.team?.id;
    // The balance counts active requests: one that becomes active, or whose
    // days, type or person change, is checked against it.
    const checksBalance =
      ACTIVE_REQUEST_STATUSES.includes(finalStatus) &&
      (hasDatesChanged ||
        isTypeChanged ||
        isUserChanged ||
        !ACTIVE_REQUEST_STATUSES.includes(existingRequest.status));

    const [workingDatesResult, overlapResult, usageResult] =
      await Promise.allSettled([
        this.findWorkingDates(startDate, endDate, userTeamId, user),
        ACTIVE_REQUEST_STATUSES.includes(finalStatus) &&
        (hasDatesChanged || isStatusChanged || isUserChanged)
          ? this.vacationRequestsValidator.validateNoOverlap({
              userId: userId ?? existingRequest.user_id,
              slackTeamId: user.slack_team_id,
              startDate,
              endDate,
              excludeRequestId: existingRequest.id,
            })
          : null,
        checksBalance
          ? Promise.resolve(
              chosenOwner ??
                this.getRequestOwner(existingRequest.user_id, user),
            ).then((owner) =>
              this.vacationRequestsValidator.getUsage(
                owner,
                { startDate, endDate },
                { excludeRequestId: existingRequest.id },
              ),
            )
          : null,
      ]);
    const workingDates = settled(workingDatesResult);
    const workingDays = workingDates.length;

    settled(overlapResult);

    if (checksBalance) {
      this.vacationRequestsValidator.checkDaysRequested(
        { startDate, endDate, workingDates },
        type,
        settled(usageResult)!,
      );
    }

    return {
      checked: existingRequest,
      changes: updateParams,
      teamId,
      days: calendarDays,
      workingDays,
    };
  }

  // Writes an edit that passed checkUpdate, in the caller's transaction and
  // under the request's lock, which the caller takes. Emits nothing: the
  // caller tells of the change once it has committed.
  public async applyUpdate(
    { checked, changes, teamId, days, workingDays }: IVacationRequestUpdate,
    user: IUserViewModel,
    assertCurrent?: (current: IVacationRequestViewModel) => void,
  ) {
    const { id, slack_team_id: slackTeamId } = checked;

    this.transactions.assertHolds(vacationRequestLock(id));

    // The request as it is under the lock: a workflow approval or another
    // edit may have changed it since the checks read it, and the caller
    // compares with it.
    const previous = await this.findOneWithValidation({ id, slackTeamId });

    assertCurrent?.(previous);

    const request = await this.vacationRequestsRepository.update(
      {
        id,
        slack_team_id: slackTeamId,
      },
      {
        ...(changes.startDate !== undefined
          ? { start_date: changes.startDate.toISOString() }
          : {}),
        ...(changes.endDate !== undefined
          ? { end_date: changes.endDate.toISOString() }
          : {}),
        type: changes.type ?? checked.type,
        ...(changes.userComment !== undefined
          ? { user_comment: changes.userComment }
          : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.userId !== undefined ? { user_id: changes.userId } : {}),
        ...(teamId !== undefined ? { team_id: teamId } : {}),
        ...(days !== checked.days ? { days } : {}),
        ...(workingDays !== checked.working_days
          ? { working_days: workingDays }
          : {}),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
    );

    return { previous, request };
  }

  public async cancel(requestId: string, user: IUserViewModel) {
    const update = await this.checkUpdate(
      { id: requestId, slackTeamId: user.slack_team_id },
      { status: VacationRequestStatus.Canceled },
      user,
    );

    this.assertCanCancel(update.checked, user);

    // Without TimeOffChangesService's cleanup: a pending request holds no
    // logged time, since only an approved one is logged and leaving approved
    // removes it. Checked again under the lock, as the workflow may have
    // approved it, and its time been logged, since the check above.
    return this.transactions.transaction(async () => {
      await this.transactions.lock(vacationRequestLock(requestId));

      const { previous, request } = await this.applyUpdate(
        update,
        user,
        (current) => this.assertCanCancel(current, user),
      );

      // Inside the transaction, as on create: the approvers' steps close
      // with it.
      await this.eventEmitter.emitAsync(
        VacationRequestEvent.Updated,
        new VacationRequestUpdatedEvent(request, user, previous),
      );

      return request;
    });
  }

  private assertCanCancel(
    request: IVacationRequestViewModel,
    user: IUserViewModel,
  ) {
    if (request.user_id !== user.id) {
      throw new ForbiddenException(
        'You can cancel only your own vacation requests',
      );
    }

    if (request.status !== VacationRequestStatus.Pending) {
      throw new ValidationError(
        'Only vacation requests waiting for approval can be canceled',
      );
    }
  }

  public findOne(
    params: IVacationRequestFindParams,
  ): Promise<IVacationRequestViewModel | null> {
    return this.vacationRequestsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(
    findParams: IVacationRequestFindParams,
  ): Promise<IVacationRequestViewModel> {
    const request = await this.findOne(findParams);

    if (!request) {
      throw new NotFoundException('Vacation Request not found');
    }

    return request;
  }

  public async findMany(params: IVacationRequestFindParams) {
    return await this.vacationRequestsRepository.findMany(
      this.getFindQuery(params),
    );
  }

  public async search(
    params: ISearchRequestsParams,
  ): Promise<ISearchResult<IVacationRequestViewModel>> {
    return this.vacationRequestsRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  // Closes the request's approvals and deletes it, in the caller's
  // transaction and under the request's lock, which the caller takes.
  // Its approval workflow is deleted with it; the approvers' messages lose
  // their buttons, as on a cancel, once the delete has committed. The
  // workflow's lock comes after the request's.
  public async applyDelete(
    request: IVacationRequestViewModel,
    user: IUserViewModel,
  ) {
    this.transactions.assertHolds(vacationRequestLock(request.id));
    await this.requestWorkflowService.closeBeforeDelete(request.id, user);
    await this.vacationRequestsRepository.deleteMany(
      this.getFindQuery({ id: request.id, slackTeamId: request.slack_team_id }),
    );
  }

  // Sets the outcome of the approval workflow if the request still waits for
  // it, in one statement. Null when it was decided (e.g. by another approver
  // at the same time) or canceled in the meantime. The listeners of the
  // change run in its transaction (the caller's, if any).
  public finishPending(
    { id, slackTeamId }: IVacationRequestFindParams,
    status: VacationRequestStatus.Approved | VacationRequestStatus.Rejected,
    decidedBy: IUserViewModel,
    rejectionReason?: string,
  ) {
    return this.transactions.transaction(async () => {
      const [finished] = await this.vacationRequestsRepository.updateMany(
        {
          id,
          slack_team_id: slackTeamId,
          status: VacationRequestStatus.Pending,
        },
        {
          status,
          rejection_reason:
            status === VacationRequestStatus.Rejected
              ? rejectionReason || null
              : null,
          updated_by: decidedBy.id,
          updated_at: new Date().toISOString(),
        },
      );

      if (!finished) {
        return null;
      }

      await this.eventEmitter.emitAsync(
        VacationRequestEvent.Updated,
        new VacationRequestUpdatedEvent(finished, decidedBy),
      );

      return finished;
    });
  }

  // The user's vacations become `vacations`, in one transaction: when the
  // database refuses one of them, the user keeps what they had, and the
  // approvals of their pending requests stay open.
  public async replaceUserVacations(
    user: IUserViewModel,
    vacations: IVacationRequestCreateParams[],
    replacedBy: IUserViewModel,
  ) {
    return this.replaceVacations([{ user, vacations }], replacedBy);
  }

  // Replaces every vacation of each user with the given ones (the CSV
  // import), and sets their contract start when given: all of them or none,
  // in one transaction, and in the same few statements however many people
  // there are. What the working days take is read before, on the pool.
  public async replaceVacations(
    replacements: IVacationsReplacement[],
    replacedBy: IUserViewModel,
  ): Promise<IVacationRequestViewModel[]> {
    if (!replacements.length) {
      return [];
    }

    const slackTeamId = replacedBy.slack_team_id;
    const vacations = replacements.flatMap((replacement) =>
      replacement.vacations.map((vacation) => ({ replacement, vacation })),
    );
    const userIds = replacements.map(({ user }) => user.id);
    const holidaysOfTeam = await this.readHolidaysOfTeams(
      slackTeamId,
      vacations.map(({ vacation }) => vacation),
    );

    const vacationRecords = vacations.map(({ replacement, vacation }) => ({
      slack_team_id: slackTeamId,
      user_id: replacement.user.id,
      start_date: vacation.startDate.toISOString(),
      end_date: vacation.endDate.toISOString(),
      days: getDaysBetweenDates(vacation.startDate, vacation.endDate),
      working_days: this.workingDaysCalculationService.workingDatesWithout(
        vacation.startDate,
        vacation.endDate,
        holidaysOfTeam(replacement.user.team_id),
      ).length,
      type: vacation.type,
      status: vacation.status,
      team_id: vacation.teamId,
      created_by: replacedBy.id,
      updated_by: replacedBy.id,
    }));
    const contractStarts = replacements
      .filter(({ contractStartDate }) => contractStartDate)
      .map(({ user, contractStartDate }) => ({
        userId: user.id,
        contractStartDate: contractStartDate!,
      }));

    return this.transactions.transaction(async () => {
      // As on Delete Request, the approvers of a pending request see their
      // message without buttons once the import has committed.
      const pending = await this.findMany({
        userIds,
        slackTeamId,
        statuses: [VacationRequestStatus.Pending],
      });

      await this.requestWorkflowService.closeManyBeforeDelete(
        pending.map(({ id }) => id),
        replacedBy,
      );
      await this.vacationRequestsRepository.deleteMany({
        slack_team_id: slackTeamId,
        user_id: userIds,
      });

      const created = await this.insertInChunks(vacationRecords);

      await this.usersService.setContractStartDates(contractStarts, replacedBy);

      return created;
    });
  }

  // Adds a leave history file's leaves as approved and marked with its
  // upload, in the caller's transaction and in the same few statements
  // however many there are. They were taken or agreed already: no workflow,
  // no event, so nobody is asked or told. A leave's working days come from
  // the holidays of the policy its team follows.
  public async addImported(
    leaves: {
      userId: string;
      teamId: string | null;
      type: VacationType;
      startDate: string;
      endDate: string;
      comment: string | null;
    }[],
    importedBy: IUserViewModel,
    uploadId: string,
  ): Promise<IVacationRequestViewModel[]> {
    if (!leaves.length) {
      return [];
    }

    const slackTeamId = importedBy.slack_team_id;
    const spans = leaves.map((leave) => ({
      leave,
      startDate: new Date(leave.startDate),
      endDate: new Date(leave.endDate),
    }));
    const holidaysOfTeam = await this.readHolidaysOfTeams(slackTeamId, spans);
    const now = new Date().toISOString();
    const records = spans.map(({ leave, startDate, endDate }) => ({
      slack_team_id: slackTeamId,
      user_id: leave.userId,
      team_id: leave.teamId,
      start_date: leave.startDate,
      end_date: leave.endDate,
      days: getDaysBetweenDates(startDate, endDate),
      working_days: this.workingDaysCalculationService.workingDatesWithout(
        startDate,
        endDate,
        holidaysOfTeam(leave.teamId),
      ).length,
      type: leave.type,
      status: VacationRequestStatus.Approved,
      user_comment: leave.comment,
      leave_file_upload_id: uploadId,
      created_by: importedBy.id,
      updated_by: importedBy.id,
      created_at: now,
      updated_at: now,
    }));

    return this.transactions.transaction(() => this.insertInChunks(records));
  }

  private async insertInChunks(
    records: Parameters<VacationRequestsRepository['createMany']>[0],
  ) {
    const created: IVacationRequestViewModel[] = [];

    for (let from = 0; from < records.length; from += INSERT_CHUNK_ROWS) {
      created.push(
        ...(await this.vacationRequestsRepository.createMany(
          records.slice(from, from + INSERT_CHUNK_ROWS),
        )),
      );
    }

    return created;
  }

  // The enabled holidays over the vacations' days of a team's vacation
  // policy (the company rules' for no team), as replaceUserVacations once
  // read them for each person: every policy's and every team's at once.
  private async readHolidaysOfTeams(
    slackTeamId: string,
    vacations: { startDate: Date; endDate: Date }[],
  ): Promise<(teamId: string | null) => Set<string>> {
    if (!vacations.length) {
      return () => new Set();
    }

    const earliest = vacations.reduce(
      (first, { startDate }) => (startDate < first ? startDate : first),
      vacations[0].startDate,
    );
    const latest = vacations.reduce(
      (last, { endDate }) => (endDate > last ? endDate : last),
      vacations[0].endDate,
    );
    const [rules, holidays] = await Promise.all([
      this.teamRulesService.forWorkspace(slackTeamId),
      this.workingDaysCalculationService.holidayDatesByPolicy(
        slackTeamId,
        earliest,
        latest,
      ),
    ]);
    const policyOf = vacationPolicyOfTeam(rules);

    return (teamId) => {
      const policyId = policyOf(teamId);

      return (policyId && holidays.get(policyId)) || new Set();
    };
  }

  private getFindQuery(params: IVacationRequestFindParams): RepositoryFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.userIds ? { user_id: params.userIds } : {}),
      ...(params.statuses
        ? { status: { operator: 'in', value: params.statuses } }
        : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.teamId ? { team_id: params.teamId } : {}),
      // An empty list matches nothing (a manager without teams).
      ...(params.teamIds
        ? { team_id: { operator: 'in', value: params.teamIds } }
        : {}),
      ...(params.year
        ? {
            start_date: { operator: 'lte', value: `${params.year}-12-31` },
            end_date: { operator: 'gte', value: `${params.year}-01-01` },
          }
        : {}),
      slack_team_id: params.slackTeamId,
      ...(params.startDate
        ? { start_date: { value: params.startDate, operator: 'gte' } }
        : {}),
      ...(params.overlapping
        ? {
            start_date: {
              operator: 'lte',
              value: params.overlapping.endDate,
            },
            end_date: {
              operator: 'gte',
              value: params.overlapping.startDate,
            },
          }
        : {}),
    };
  }

  // People request time off for themselves, and their request waits for
  // approval. Only HR and admins make one for someone else or with another
  // status (the admin form, e.g. to record time off already agreed).
  private assertCanCreate(
    { userId, status }: IVacationRequestCreateParams,
    actor: IUserViewModel,
  ) {
    if (isPeopleAdmin(actor.role)) {
      return;
    }

    if (userId !== actor.id) {
      throw new ForbiddenException(
        'You can request time off only for yourself',
      );
    }

    if (status !== VacationRequestStatus.Pending) {
      throw new ForbiddenException(
        'Only HR and admins can create a request that is not pending',
      );
    }
  }

  private async findWorkingDates(
    startDate: Date,
    endDate: Date,
    teamId: string | null | undefined,
    user: IUserViewModel,
  ) {
    const { vacationPolicyId } = await this.teamRulesService.forTeam(
      teamId,
      user.slack_team_id,
    );

    return this.workingDaysCalculationService.workingDates(
      startDate,
      endDate,
      vacationPolicyId,
      user.slack_team_id,
    );
  }

  // Whose vacation it is: the acting user, unless HR or an admin acts for
  // someone else. Their team's policy and their balance are what count.
  private async getRequestOwner(ownerId: string, actor: IUserViewModel) {
    if (ownerId === actor.id) {
      return actor;
    }

    return this.usersService.findOneWithValidation({
      id: ownerId,
      slackTeamId: actor.slack_team_id,
    });
  }
}
