import { Injectable, NotFoundException } from '@nestjs/common';
import IHolidayViewModel from 'src/holidays/types/holiday.interface';
import { HolidaysRepository } from 'src/holidays/repositories/holidays.repository';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  ISearchParams,
  ISearchResult,
} from 'src/common/types/pagination.types';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import { getDateOnly } from 'src/common/utils/date.utils';
import { SupabaseFilter } from 'src/common/repositories/base.repository';

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
  public constructor(private readonly holidaysRepository: HolidaysRepository) {}

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
        new Date(createParams.date).getFullYear(),
        createParams.slackTeamId,
      );
    }

    return await this.holidaysRepository.create({
      name: createParams.name,
      date: createParams.date,
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

  public async update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    return await this.holidaysRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.date ? { date: updateParams.date } : {}),
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
      ...(params.year && { year: params.year }),
      ...(params.isCompanyCustom !== undefined
        ? { is_company_custom: params.isCompanyCustom }
        : {}),
      ...(params.vacationPolicyId && {
        vacation_policy_id: params.vacationPolicyId,
      }),
      ...(params.excludeDisabled ? { is_disabled: false } : {}),
    } as SupabaseFilter;
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

    if (count >= 5) {
      throw new MaxItemsCountReachedError(5, 'company holidays');
    }
  }
}
