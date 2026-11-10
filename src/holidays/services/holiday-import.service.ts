import { Injectable, Logger } from '@nestjs/common';
import HolidaysService from '@modules/holidays/services/holidays.service';
import { CountryHolidaysProvider } from '@modules/holidays/providers/country-holidays.provider';
import { IUserViewModel } from '@modules/users/types/user.interface';

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

    // Nager.Date first: when it is down, the policy keeps its holidays.
    const holidays = await this.countryHolidaysProvider.getHolidays(
      countryCode,
      year,
    );

    // In one transaction: the country holidays imported before go, the
    // company's own ones stay.
    await this.holidaysService.replaceCountryHolidays(
      { slackTeamId, vacationPolicyId: policyId, year },
      holidays.map(({ name, date }) => ({ name, date, countryCode })),
      user,
    );

    this.logger.log(
      `Imported ${holidays.length} holidays for policy=${policyId}, year=${year}`,
    );

    return holidays.length;
  }
}
