import { Injectable, Inject } from '@nestjs/common';
import {
  NagerDateClient,
  INagerDateHoliday,
} from '@modules/holidays/clients/nager-date.client';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';

export interface ICountryHoliday {
  date: string;
  name: string;
}

export interface ICountryHolidaysProvider {
  getHolidays(country: string, year: number): Promise<ICountryHoliday[]>;
}

@Injectable()
export class CountryHolidaysProvider implements ICountryHolidaysProvider {
  // An hour. cache-manager takes milliseconds.
  private readonly ttlMs = 60 * 60 * 1000;

  public constructor(
    private readonly nagerClient: NagerDateClient,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  public async getHolidays(
    country: string,
    year: number,
  ): Promise<ICountryHoliday[]> {
    const cacheKey = `holidays:${country}:${year}`;
    const cached = await this.cacheManager.get<ICountryHoliday[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const nagerResponse = await this.nagerClient.fetchHolidays(country, year);
    const holidays = this.mapHolidays(nagerResponse);

    await this.cacheManager.set(cacheKey, holidays, this.ttlMs);

    return holidays;
  }

  private mapHolidays(data: INagerDateHoliday[]): ICountryHoliday[] {
    return data.map(({ date, name }) => ({ date, name }));
  }
}
