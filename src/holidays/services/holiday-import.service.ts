import { Injectable, Logger } from '@nestjs/common';
import HolidaysService from '@modules/holidays/services/holidays.service';
import {
  CountryHolidaysProvider,
  ICountryHoliday,
} from '@modules/holidays/providers/country-holidays.provider';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ValidationError } from '@common/errors/validation.error';

interface IImportParams {
  policyId: string;
  countryCode: string;
  year: number;
  slackTeamId: string;
  // A region of the country (ISO 3166-2), whose own holidays come too;
  // without one, only the whole country's.
  region?: string;
}

@Injectable()
export default class HolidayImportService {
  private readonly logger = new Logger(HolidayImportService.name);

  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly countryHolidaysProvider: CountryHolidaysProvider,
  ) {}

  // The regions with holidays of their own in the country that year.
  public async regions(countryCode: string, year: number): Promise<string[]> {
    return regionsOf(
      await this.countryHolidaysProvider.getHolidays(countryCode, year),
    );
  }

  public async import(
    { policyId, countryCode, year, slackTeamId, region }: IImportParams,
    user: IUserViewModel,
  ): Promise<number> {
    this.logger.log(
      `Importing holidays for policy=${policyId}, country=${countryCode}, region=${region ?? '-'}, year=${year}`,
    );

    // Nager.Date first: when it is down, the policy keeps its holidays.
    const countryHolidays = await this.countryHolidaysProvider.getHolidays(
      countryCode,
      year,
    );

    // The form may name a region of the country chosen before this one.
    if (region && !regionsOf(countryHolidays).includes(region)) {
      throw new ValidationError(
        'This region has no holidays of its own in this country. Choose the region again.',
        'region',
      );
    }

    const holidays = oneADay(
      countryHolidays.filter(
        ({ regions }) => !regions || (!!region && regions.includes(region)),
      ),
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

const regionsOf = (holidays: ICountryHoliday[]) =>
  [...new Set(holidays.flatMap(({ regions }) => regions ?? []))].sort();

// Nager.Date may list one day twice, e.g. under two names in different
// regions; a day off is one holiday.
const oneADay = (holidays: ICountryHoliday[]) => {
  const seen = new Set<string>();

  return holidays.filter(({ date }) => !seen.has(date) && !!seen.add(date));
};
