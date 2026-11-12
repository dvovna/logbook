import { Injectable, HttpException } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';

export interface INagerDateHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  // false for a holiday of some regions only, which `counties` names
  // (ISO 3166-2, e.g. 'GB-SCT').
  global: boolean;
  counties?: string[] | null;
  launchYear?: number | null;
  // 'Public' for a day off; also 'Bank', 'School', 'Authorities',
  // 'Optional' and 'Observance'.
  types: string[];
}

@Injectable()
export class NagerDateClient {
  public constructor(private readonly http: HttpService) {}

  public async fetchHolidays(
    country: string,
    year: number,
  ): Promise<INagerDateHoliday[]> {
    const url = this.getUrl(country, year);

    try {
      const response = await lastValueFrom<{ data: INagerDateHoliday[] }>(
        this.http.get<INagerDateHoliday[]>(url),
      );

      return response.data;
    } catch (err) {
      throw new HttpException(
        `Failed to fetch holidays from Nager.Date: ${err.message}`,
        err.response?.status || 500,
      );
    }
  }

  private getUrl(country: string, year: number): string {
    return `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
  }
}
