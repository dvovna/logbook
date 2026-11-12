import { HttpException } from '@nestjs/common';
import {
  INagerDateHoliday,
  NagerDateClient,
} from 'src/holidays/clients/nager-date.client';

type PublicMethods<T> = Pick<T, keyof T>;

// Stands in for Nager.Date (public holidays by country), so the tests never
// go to the internet. Answers with the holidays a test registered.
export class FakeNagerDateClient implements PublicMethods<NagerDateClient> {
  private readonly holidays = new Map<string, INagerDateHoliday[]>();
  private readonly down = new Set<string>();

  // [date, name], with the regions of a regional holiday and its types as
  // Nager.Date gives them (a public holiday of the whole country without).
  public addHolidays(
    country: string,
    year: number,
    holidays: [string, string, { counties?: string[]; types?: string[] }?][],
  ) {
    this.holidays.set(
      `${country}:${year}`,
      holidays.map(([date, name, { counties, types } = {}]) => ({
        date,
        name,
        localName: name,
        countryCode: country,
        fixed: true,
        global: !counties,
        counties: counties ?? null,
        types: types ?? ['Public'],
      })),
    );
  }

  // Requests for `country` fail like the real client does when the API is
  // down.
  public failFor(country: string) {
    this.down.add(country);
  }

  public async fetchHolidays(country: string, year: number) {
    if (this.down.has(country)) {
      throw new HttpException(
        'Failed to fetch holidays from Nager.Date: Service Unavailable',
        503,
      );
    }

    return this.holidays.get(`${country}:${year}`) ?? [];
  }
}
