import { Injectable, NotFoundException } from '@nestjs/common';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';
import { HolidaysRepository } from '@modules/holidays/repositories/holidays.repository';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { getDateOnly } from '@common/utils/date.utils';
import { RepositoryFilter } from '@common/repositories/repository.types';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';

interface ICreateParams {
  name: string;
  date: string; // ISO date string
  isCompanyCustom: boolean;
  countryCode?: string;
  slackTeamId: string;
  vacationPolicyId: string;
}

interface IUpdateParams {
  name?: string;
  date?: string; // ISO date string
  isCompanyCustom?: boolean;
  isDisabled?: boolean;
}

interface IFindParams {
  slackTeamId: string;
  year?: number;
  id?: string;
  ids?: string[];
  startDate?: Date;
  endDate?: Date;
  vacationPolicyId?: string;
  isCompanyCustom?: boolean;
  excludeDisabled?: boolean;
}

type ISearchHolidaysParams = ISearchParams<IFindParams>;

interface IHolidaysService {
  create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel>;
  createMany(
    createParams: ICreateParams[],
    user: IUserViewModel,
  ): Promise<IHolidayViewModel[]>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel>;
  search(
    searchParams: ISearchHolidaysParams,
  ): Promise<ISearchResult<IHolidayViewModel>>;
  findOne(findParams: IFindParams): Promise<IHolidayViewModel | null>;
  findOneWithValidation(findParams: IFindParams): Promise<IHolidayViewModel>;
  findMany(findParams: IFindParams): Promise<IHolidayViewModel[]>;
}

@Injectable()
export default class HolidaysService implements IHolidaysService {
  constructor(
    private readonly holidaysRepository: HolidaysRepository,
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
  ) {}

  public async search(
    params: ISearchHolidaysParams,
  ): Promise<ISearchResult<IHolidayViewModel>> {
    return this.holidaysRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  public async findMany(findParams: IFindParams) {
    return this.holidaysRepository.findMany(this.getFindQuery(findParams));
  }

  public async findOne(findParams: IFindParams) {
    return this.holidaysRepository.findOne(this.getFindQuery(findParams));
  }

  public async findOneWithValidation(findParams: IFindParams) {
    const holiday = await this.findOne(findParams);

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }

  public async create(
    createParams: ICreateParams,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    const now = new Date().toISOString();

    if (createParams.isCompanyCustom) {
      await this.validateCustomHolidayLimit(
        createParams.vacationPolicyId,
        yearOf(createParams.date),
        createParams.slackTeamId,
      );
    }

    return await this.holidaysRepository.create({
      name: createParams.name,
      date: createParams.date,
      year: yearOf(createParams.date),
      is_company_custom: createParams.isCompanyCustom,
      slack_team_id: createParams.slackTeamId,
      vacation_policy_id: createParams.vacationPolicyId,
      country_code: createParams.countryCode,
      is_disabled: false,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    });
  }

  public async createMany(
    createParamsArray: ICreateParams[],
    user: IUserViewModel,
  ): Promise<IHolidayViewModel[]> {
    const now = new Date().toISOString();

    const holidaysToCreate = createParamsArray.map((createParams) => ({
      name: createParams.name,
      date: createParams.date,
      year: yearOf(createParams.date),
      is_company_custom: createParams.isCompanyCustom,
      slack_team_id: createParams.slackTeamId,
      vacation_policy_id: createParams.vacationPolicyId,
      country_code: createParams.countryCode,
      is_disabled: false,
      created_at: now,
      updated_at: now,
      created_by: user.id,
      updated_by: user.id,
    }));

    return await this.holidaysRepository.createMany(holidaysToCreate);
  }

  // A policy's country holidays of `year` become `holidays`, in one
  // transaction; the company's own holidays stay, and a date that was
  // switched off stays off.
  public replaceCountryHolidays(
    params: { slackTeamId: string; vacationPolicyId: string; year: number },
    holidays: { name: string; date: string; countryCode: string }[],
    user: IUserViewModel,
  ): Promise<IHolidayViewModel[]> {
    const policy = {
      slack_team_id: params.slackTeamId,
      vacation_policy_id: params.vacationPolicyId,
    };

    const countryHolidaysOfYear = {
      ...policy,
      year: params.year,
      is_company_custom: false,
    };

    return this.transactions.transaction(async () => {
      const switchedOff = new Set(
        (
          await this.holidaysRepository.findMany({
            ...countryHolidaysOfYear,
            is_disabled: true,
          })
        ).map(({ date }) => date),
      );

      await this.holidaysRepository.deleteMany(countryHolidaysOfYear);

      return this.holidaysRepository.createMany(
        holidays.map(({ name, date, countryCode }) => ({
          ...policy,
          name,
          date,
          year: yearOf(date),
          is_company_custom: false,
          is_disabled: switchedOff.has(date),
          country_code: countryCode,
          created_by: user.id,
          updated_by: user.id,
        })),
      );
    });
  }

  public async update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    // A company holiday moved to another year counts toward that year's
    // limit, and is listed under it.
    if (updateParams.date) {
      const holiday = await this.findOneWithValidation(findParams);
      const year = yearOf(updateParams.date);

      if (
        (updateParams.isCompanyCustom ?? holiday.is_company_custom) &&
        year !== yearOf(holiday.date)
      ) {
        await this.validateCustomHolidayLimit(
          holiday.vacation_policy_id,
          year,
          findParams.slackTeamId,
        );
      }
    }

    return await this.holidaysRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.date
        ? { date: updateParams.date, year: yearOf(updateParams.date) }
        : {}),
      ...(updateParams.isCompanyCustom !== undefined
        ? { is_company_custom: updateParams.isCompanyCustom }
        : {}),
      ...(updateParams.isDisabled !== undefined
        ? { is_disabled: updateParams.isDisabled }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  }

  public async deleteMany(findParams: IFindParams): Promise<number> {
    return await this.holidaysRepository.deleteMany(
      this.getFindQuery(findParams),
    );
  }

  private getFindQuery(params: IFindParams) {
    return {
      slack_team_id: params.slackTeamId,
      ...(params.startDate || params.endDate
        ? {
            date: [
              ...(params.startDate
                ? [{ operator: 'gte', value: getDateOnly(params.startDate) }]
                : []),
              ...(params.endDate
                ? [{ operator: 'lte', value: getDateOnly(params.endDate) }]
                : []),
            ],
          }
        : {}),
      ...(params.id && { id: params.id }),
      ...(params.ids && { id: { operator: 'in', value: params.ids } }),
      ...(params.year && { year: params.year }),
      ...(params.isCompanyCustom !== undefined
        ? { is_company_custom: params.isCompanyCustom }
        : {}),
      ...(params.vacationPolicyId && {
        vacation_policy_id: params.vacationPolicyId,
      }),
      ...(params.excludeDisabled ? { is_disabled: false } : {}),
    } as RepositoryFilter;
  }

  private async validateCustomHolidayLimit(
    vacationPolicyId: string,
    year: number,
    slackTeamId: string,
  ): Promise<void> {
    const count = await this.holidaysRepository.count(
      this.getFindQuery({
        vacationPolicyId,
        slackTeamId,
        year,
        isCompanyCustom: true,
      }),
    );

    const maxCompanyHolidays = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxCompanyHolidaysPerCompanyPerYear,
    );

    if (count >= maxCompanyHolidays) {
      throw new MaxItemsCountReachedError(
        maxCompanyHolidays,
        'company holidays',
      );
    }
  }
}

// Of a 'YYYY-MM-DD' date.
const yearOf = (date: string) => Number(date.slice(0, 4));
