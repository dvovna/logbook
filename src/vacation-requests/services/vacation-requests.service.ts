import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import { TransactionService } from 'src/database/transaction.service';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationType from '@common/enums/vacation-type.enum';
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

interface ICreateParams {
  userId: string;
  teamId: string | null;
  startDate: Date;
  endDate: Date;
  type: VacationType;
  status: VacationRequestStatus;
  userComment?: string | null;
}

interface IUpdateParams {
  teamId?: string | null;
  startDate?: Date;
  endDate?: Date;
  type?: VacationType;
  status?: VacationRequestStatus;
  userComment?: string | null;
  userId?: string;
}

interface IFindParams {
  id?: string;
  userId?: string;
  teamId?: string;
  teamIds?: string[];
  year?: string;
  startDate?: string;
  // Requests that share at least one day with this period.
  overlapping?: { startDate: string; endDate: string };
  statuses?: VacationRequestStatus[];
  type?: VacationType;
  slackTeamId: string;
}

type ISearchRequestsParams = ISearchParams<IFindParams>;

interface IVacationRequestsService {
  create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<IVacationRequestViewModel>;
  findOneWithValidation(
    findParams: IFindParams,
  ): Promise<IVacationRequestViewModel>;
  findMany(findParams: IFindParams): Promise<IVacationRequestViewModel[]>;
  search(
    searchParams: ISearchRequestsParams,
  ): Promise<ISearchResult<IVacationRequestViewModel>>;
  replaceUserVacations(
    user: IUserViewModel,
    vacations: ICreateParams[],
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
  ) {}

  public async create(createParams: ICreateParams, user: IUserViewModel) {
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

    const userTeam = teamId
      ? await this.teamsService.findOne({
          id: teamId,
          slackTeamId: user.slack_team_id,
        })
      : null;

    const workingDays = await this.workingDaysCalculationService.calculate(
      startDate,
      endDate,
      userTeam?.vacation_policy_id || null,
      user.slack_team_id,
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

  public async update(
    { id, slackTeamId }: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ) {
    const existingRequest = await this.findOneWithValidation({
      id,
      slackTeamId,
    });

    const userTeamId = updateParams.teamId || existingRequest.team?.id;
    const userTeam = userTeamId
      ? await this.teamsService.findOneWithValidation({
          id: updateParams.teamId || existingRequest.team?.id,
          slackTeamId: user.slack_team_id,
        })
      : null;

    const {
      startDate = new Date(existingRequest.start_date),
      endDate = new Date(existingRequest.end_date),
      type = existingRequest.type,
      userComment,
      status,
      userId,
      teamId,
    } = updateParams;

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

    const workingDays = await this.workingDaysCalculationService.calculate(
      startDate,
      endDate,
      userTeam?.vacation_policy_id || null,
      user.slack_team_id,
    );

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

    if (
      ACTIVE_REQUEST_STATUSES.includes(finalStatus) &&
      (hasDatesChanged || isStatusChanged || isUserChanged)
    ) {
      await this.vacationRequestsValidator.validateNoOverlap({
        userId: userId ?? existingRequest.user_id,
        slackTeamId: user.slack_team_id,
        startDate,
        endDate,
        excludeRequestId: existingRequest.id,
      });
    }

    if (hasDatesChanged) {
      await this.vacationRequestsValidator.validateDaysRequested(
        {
          calendarDays,
          workingDays,
        },
        type,
        await this.getRequestOwner(userId ?? existingRequest.user_id, user),
      );
    }

    const updatedRequest = await this.vacationRequestsRepository.update(
      {
        id,
        slack_team_id: slackTeamId,
      },
      {
        ...(updateParams.startDate !== undefined
          ? { start_date: startDate.toISOString() }
          : {}),
        ...(updateParams.endDate !== undefined
          ? { end_date: endDate.toISOString() }
          : {}),
        ...(type !== undefined ? { type } : {}),
        ...(userComment !== undefined ? { user_comment: userComment } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(userId !== undefined ? { user_id: userId } : {}),
        ...(teamId !== undefined ? { team_id: teamId } : {}),
        ...(calendarDays !== existingRequest.days
          ? { days: calendarDays }
          : {}),
        ...(workingDays !== existingRequest.working_days
          ? { working_days: workingDays }
          : {}),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
    );

    this.eventEmitter.emit(
      VacationRequestEvent.Updated,
      new VacationRequestUpdatedEvent(updatedRequest, user, existingRequest),
    );

    return updatedRequest;
  }

  public async cancel(requestId: string, user: IUserViewModel) {
    const request = await this.findOneWithValidation({
      id: requestId,
      slackTeamId: user.slack_team_id,
    });

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

    return this.update(
      { id: requestId, slackTeamId: user.slack_team_id },
      { status: VacationRequestStatus.Canceled },
      user,
    );
  }

  public findOne(
    params: IFindParams,
  ): Promise<IVacationRequestViewModel | null> {
    return this.vacationRequestsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(
    findParams: IFindParams,
  ): Promise<IVacationRequestViewModel> {
    const request = await this.findOne(findParams);

    if (!request) {
      throw new NotFoundException('Vacation Request not found');
    }

    return request;
  }

  public async findMany(params: IFindParams) {
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

  public async delete(findParams: IFindParams, user: IUserViewModel) {
    const request = await this.findOneWithValidation(findParams);

    await this.vacationRequestsRepository.deleteMany(
      this.getFindQuery(findParams),
    );

    this.eventEmitter.emit(
      VacationRequestEvent.Deleted,
      new VacationRequestUpdatedEvent(request, user),
    );

    return request;
  }

  // Sets the outcome of the approval workflow if the request still waits for
  // it, in one statement. Null when it was decided (e.g. by another approver
  // at the same time) or canceled in the meantime.
  public async finishPending(
    { id, slackTeamId }: IFindParams,
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
  // database refuses one of them, the user keeps what they had.
  public async replaceUserVacations(
    user: IUserViewModel,
    vacations: ICreateParams[],
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
      await this.vacationRequestsRepository.deleteMany(owner);

      return this.vacationRequestsRepository.createMany(
        vacationRecords.map((record) => ({ ...record, ...owner })),
      );
    });
  }

  private getFindQuery(params: IFindParams): RepositoryFilter {
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
    { userId, status }: ICreateParams,
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
