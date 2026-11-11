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
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  VacationRequestsValidationService,
  ACTIVE_REQUEST_STATUSES,
} from '@modules/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import TeamsService from '@modules/teams/services/teams.service';
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
    private readonly teamsService: TeamsService,
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

    const workingDays = await this.countWorkingDays(
      startDate,
      endDate,
      teamId,
      user,
    );

    const calendarDays = getDaysBetweenDates(
      createParams.startDate,
      createParams.endDate,
    );

    await this.vacationRequestsValidator.validateDaysRequested(
      {
        calendarDays,
        workingDays,
      },
      type,
      await this.getRequestOwner(userId, user),
    );

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

    const request =
      await this.vacationRequestsRepository.create(vacationRecord);

    this.eventEmitter.emit(
      VacationRequestEvent.Created,
      new VacationRequestCreatedEvent(request, user),
    );

    return request;
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
    const userTeamId = teamId || existingRequest.team?.id;

    const [workingDaysResult, overlapResult, usageResult] =
      await Promise.allSettled([
        this.countWorkingDays(startDate, endDate, userTeamId, user),
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
        hasDatesChanged
          ? Promise.resolve(
              chosenOwner ??
                this.getRequestOwner(existingRequest.user_id, user),
            ).then((owner) => this.vacationRequestsValidator.getUsage(owner))
          : null,
      ]);
    const workingDays = settled(workingDaysResult);

    settled(overlapResult);

    if (hasDatesChanged) {
      this.vacationRequestsValidator.checkDaysRequested(
        { calendarDays, workingDays },
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

  // Writes an edit that passed checkUpdate, in the caller's transaction,
  // under the request's lock (taken here; a lock the caller holds costs
  // nothing). Emits nothing: the caller tells of the change once it has
  // committed.
  public async applyUpdate(
    { checked, changes, teamId, days, workingDays }: IVacationRequestUpdate,
    user: IUserViewModel,
    assertCurrent?: (current: IVacationRequestViewModel) => void,
  ) {
    const { id, slack_team_id: slackTeamId } = checked;

    await this.transactions.lock(vacationRequestLock(id));

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
    const findParams = { id: requestId, slackTeamId: user.slack_team_id };

    this.assertCanCancel(await this.findOneWithValidation(findParams), user);

    const update = await this.checkUpdate(
      findParams,
      { status: VacationRequestStatus.Canceled },
      user,
    );
    // Without TimeOffChangesService's cleanup: a pending request holds no
    // logged time, since only an approved one is logged and leaving approved
    // removes it. Checked again under the lock, as the workflow may have
    // approved it, and its time been logged, since the check above.
    const { previous, request } = await this.transactions.transaction(() =>
      this.applyUpdate(update, user, (current) =>
        this.assertCanCancel(current, user),
      ),
    );

    this.eventEmitter.emit(
      VacationRequestEvent.Updated,
      new VacationRequestUpdatedEvent(request, user, previous),
    );

    return request;
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
  // transaction, under the request's lock (taken here, as in applyUpdate).
  // Its approval workflow is deleted with it; the approvers' messages lose
  // their buttons, as on a cancel, once the delete has committed. The
  // workflow's lock comes after the request's.
  public async applyDelete(
    request: IVacationRequestViewModel,
    user: IUserViewModel,
  ) {
    await this.transactions.lock(vacationRequestLock(request.id));
    await this.requestWorkflowService.closeBeforeDelete(request.id, user);
    await this.vacationRequestsRepository.deleteMany(
      this.getFindQuery({ id: request.id, slackTeamId: request.slack_team_id }),
    );
  }

  // Sets the outcome of the approval workflow if the request still waits for
  // it, in one statement. Null when it was decided (e.g. by another approver
  // at the same time) or canceled in the meantime.
  public async finishPending(
    { id, slackTeamId }: IVacationRequestFindParams,
    status: VacationRequestStatus.Approved | VacationRequestStatus.Rejected,
    decidedBy: IUserViewModel,
    rejectionReason?: string,
  ) {
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

    this.eventEmitter.emit(
      VacationRequestEvent.Updated,
      new VacationRequestUpdatedEvent(finished, decidedBy),
    );

    return finished;
  }

  // The user's vacations become `vacations`, in one transaction: when the
  // database refuses one of them, the user keeps what they had, and the
  // approvals of their pending requests stay open.
  public async replaceUserVacations(
    user: IUserViewModel,
    vacations: IVacationRequestCreateParams[],
    replacedBy: IUserViewModel,
  ) {
    const userTeam = user.team_id
      ? await this.teamsService.findOne({
          id: user.team_id,
          slackTeamId: replacedBy.slack_team_id,
        })
      : null;

    const vacationRecords = await Promise.all(
      vacations.map(async (vacation) => ({
        start_date: vacation.startDate.toISOString(),
        end_date: vacation.endDate.toISOString(),
        days: getDaysBetweenDates(vacation.startDate, vacation.endDate),
        working_days: await this.workingDaysCalculationService.calculate(
          vacation.startDate,
          vacation.endDate,
          userTeam?.vacation_policy_id || null,
          user.slack_team_id,
        ),
        type: vacation.type,
        status: vacation.status,
        team_id: vacation.teamId,
        created_by: replacedBy.id,
        updated_by: replacedBy.id,
      })),
    );

    const owner = { slack_team_id: replacedBy.slack_team_id, user_id: user.id };

    return this.transactions.transaction(async () => {
      // As on Delete Request, the approvers of a pending request see their
      // message without buttons once the import has committed.
      const pending = await this.findMany({
        userId: user.id,
        slackTeamId: replacedBy.slack_team_id,
        statuses: [VacationRequestStatus.Pending],
      });

      // In the order of their workflow locks (compareLocks).
      for (const id of pending.map((request) => request.id).sort()) {
        await this.requestWorkflowService.closeBeforeDelete(id, replacedBy);
      }

      await this.vacationRequestsRepository.deleteMany(owner);

      return this.vacationRequestsRepository.createMany(
        vacationRecords.map((record) => ({ ...record, ...owner })),
      );
    });
  }

  private getFindQuery(params: IVacationRequestFindParams): RepositoryFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
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

  private async countWorkingDays(
    startDate: Date,
    endDate: Date,
    teamId: string | null | undefined,
    user: IUserViewModel,
  ) {
    const team = teamId
      ? await this.teamsService.findOneWithValidation({
          id: teamId,
          slackTeamId: user.slack_team_id,
        })
      : null;

    return this.workingDaysCalculationService.calculate(
      startDate,
      endDate,
      team?.vacation_policy_id || null,
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
