import { Injectable, Logger } from '@nestjs/common';
import HolidaysService from 'src/holidays/services/holidays.service';
import { CountryHolidaysProvider } from 'src/holidays/providers/country-holidays.provider';
import { IUserViewModel } from 'src/users/types/user.interface';

interface IImportParams {
  policyId: string;
  countryCode: string;
  year: number;
  slackTeamId: string;
}

@Injectable()
export default class HolidayImportService {
  private readonly logger = new Logger(HolidayImportService.name);

  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly countryHolidaysProvider: CountryHolidaysProvider,
  ) {}

  public async import(
    { policyId, countryCode, year, slackTeamId }: IImportParams,
    user: IUserViewModel,
  ): Promise<number> {
    this.logger.log(
      `Importing holidays for policy=${policyId}, country=${countryCode}, year=${year}`,
    );

    await this.holidaysService.deleteMany({
      slackTeamId,
      vacationPolicyId: policyId,
      year,
    });

    const holidays = await this.countryHolidaysProvider.getHolidays(
      countryCode,
      year,
    );

    await this.holidaysService.createMany(
      holidays.map((holiday) => ({
        name: holiday.name,
        date: holiday.date,
        isCompanyCustom: false,
        slackTeamId,
        countryCode,
        vacationPolicyId: policyId,
      })),
      user,
    );

    this.logger.log(
      `Imported ${holidays.length} holidays for policy=${policyId}, year=${year}`,
    );

    return holidays.length;
  }
}
