import { Injectable, NotFoundException } from '@nestjs/common';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import getDaysBetweenDates from 'src/common/utils/get-days-between-dates';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import {
  ISearchParams,
  ISearchResult,
} from 'src/common/types/pagination.types';
import { SupabaseFilter } from 'src/common/repositories/base.repository';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import TeamsService from 'src/teams/teams.service';
import { getDateOnly } from 'src/common/utils/date.utils';

interface ICreateParams {
  userId: string;
  teamId: string;
  startDate: Date;
  endDate: Date;
  type: VacationType;
  status: VacationStatus;
  comment?: string | null;
}

interface IUpdateParams {
  teamId: string;
  startDate?: Date;
  endDate?: Date;
  type?: VacationType;
  status?: VacationStatus;
  comment?: string | null;
  userId?: string;
}

interface IFindParams {
  id?: string;
  userId?: string;
  teamId?: string;
  year?: string;
  startDate?: string;
  status?: VacationStatus;
  type?: VacationType;
  slackTeamId?: string;
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
  ) {}

  public async create(createParams: ICreateParams, user: IUserViewModel) {
    const { userId, teamId, startDate, endDate, type } = createParams;

    await this.vacationRequestsValidator.validateRequestLimits(userId, teamId);

    const userTeam = await this.teamsService.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    const workingDays = await this.workingDaysCalculationService.calculate(
      startDate,
      endDate,
      userTeam.vacation_policy_id,
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
      user,
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
      comment: createParams.comment || null,
      slack_team_id: user.slack_team_id,
      approved_by_hr: false,
      approved_by_manager: false,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    };

    return await this.vacationRequestsRepository.create(vacationRecord);
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

    const userTeam = await this.teamsService.findOneWithValidation({
      id: updateParams.teamId,
      slackTeamId: user.slack_team_id,
    });

    const {
      startDate = new Date(existingRequest.start_date),
      endDate = new Date(existingRequest.end_date),
      type = existingRequest.type,
      comment,
      status,
      userId,
    } = updateParams;

    const workingDays = await this.workingDaysCalculationService.calculate(
      startDate,
      endDate,
      userTeam.vacation_policy_id,
      user.slack_team_id,
    );

    const calendarDays = getDaysBetweenDates(startDate, endDate);
    const hasDatesChanged =
      (updateParams.startDate &&
        getDateOnly(updateParams.startDate) !== existingRequest.start_date) ||
      (updateParams.endDate &&
        getDateOnly(updateParams.endDate) !== existingRequest.end_date);

    if (hasDatesChanged) {
      await this.vacationRequestsValidator.validateDaysRequested(
        {
          calendarDays,
          workingDays,
        },
        type,
        user,
      );
    }

    return await this.vacationRequestsRepository.update(
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
        ...(comment !== undefined ? { comment: comment } : {}),
        ...(status !== undefined ? { status: status } : {}),
        ...(userId !== undefined ? { user_id: userId } : {}),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
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
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
      searchTerm: params.searchTerm,
    });
  }

  public async delete(findParams: IFindParams) {
    const request = await this.findOneWithValidation(findParams);

    await this.vacationRequestsRepository.deleteMany(
      this.getFindQuery(findParams),
    );

    return request;
  }

  public async replaceUserVacations(
    user: IUserViewModel,
    vacations: ICreateParams[],
    replacedBy: IUserViewModel,
  ) {
    await this.vacationRequestsRepository.deleteMany({
      user_id: user.id,
      slack_team_id: replacedBy.slack_team_id,
    });

    const userTeam = await this.teamsService.findOneWithValidation({
      id: user.team_id,
      slackTeamId: replacedBy.slack_team_id,
    });

    const now = new Date().toISOString();
    const vacationRecords = await Promise.all(
      vacations.map(async (vacation) => {
        const workingDays = await this.workingDaysCalculationService.calculate(
          vacation.startDate,
          vacation.endDate,
          userTeam.vacation_policy_id,
          user.slack_team_id,
        );

        return {
          user_id: user.id,
          start_date: vacation.startDate.toISOString(),
          end_date: vacation.endDate.toISOString(),
          days: getDaysBetweenDates(vacation.startDate, vacation.endDate),
          working_days: workingDays,
          type: vacation.type,
          status: vacation.status,
          team_id: vacation.teamId,
          slack_team_id: replacedBy.slack_team_id,
          created_at: now,
          updated_at: now,
          created_by: replacedBy.id,
          updated_by: replacedBy.id,
        };
      }),
    );

    return await this.vacationRequestsRepository.createMany(vacationRecords);
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.teamId ? { team_id: params.teamId } : {}),
      ...(params.year ? { year: params.year } : {}),
      ...(params.slackTeamId ? { slack_team_id: params.slackTeamId } : {}),
      ...(params.startDate
        ? { start_date: { value: params.startDate, operator: 'gte' } }
        : {}),
    };
  }
}
