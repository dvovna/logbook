import { Injectable } from '@nestjs/common';
import HolidaysService from '@modules/holidays/services/holidays.service';
import { getDateOnly } from '@common/utils/date.utils';

@Injectable()
export class VacationDaysCalculationService {
  public constructor(private readonly holidaysService: HolidaysService) {}

  public async calculate(
    start: Date,
    end: Date,
    vacationPolicyId: string | null,
    slackTeamId: string,
  ): Promise<number> {
    return (await this.workingDates(start, end, vacationPolicyId, slackTeamId))
      .length;
  }

  // The days from `start` to `end` that count: no weekends, no enabled
  // holiday of the policy (as 'YYYY-MM-DD').
  public async workingDates(
    start: Date,
    end: Date,
    vacationPolicyId: string | null,
    slackTeamId: string,
  ): Promise<string[]> {
    const holidays = vacationPolicyId
      ? await this.getHolidaysInRange(vacationPolicyId, slackTeamId, start, end)
      : [];

    const holidayDates = holidays.map((holiday) => holiday.date);

    const dates: string[] = [];
    const current = new Date(start);

    while (current <= end) {
      const isWeekend = [0, 6].includes(current.getDay());
      const date = getDateOnly(current);

      if (!isWeekend && !holidayDates.includes(date)) {
        dates.push(date);
      }

      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  private getHolidaysInRange(
    vacationPolicyId: string,
    slackTeamId: string,
    start: Date,
    end: Date,
  ) {
    return this.holidaysService.findMany({
      slackTeamId,
      vacationPolicyId,
      startDate: start,
      endDate: end,
      excludeDisabled: true,
    });
  }
}
