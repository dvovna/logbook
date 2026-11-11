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
    return this.workingDatesWithout(
      start,
      end,
      await this.holidayDates(vacationPolicyId, slackTeamId, start, end),
    );
  }

  // The enabled holidays of the policy from `start` to `end`, none without a
  // policy.
  public async holidayDates(
    vacationPolicyId: string | null,
    slackTeamId: string,
    start: Date,
    end: Date,
  ): Promise<Set<string>> {
    if (!vacationPolicyId) {
      return new Set();
    }

    const holidays = await this.holidaysService.findMany({
      slackTeamId,
      vacationPolicyId,
      startDate: start,
      endDate: end,
      excludeDisabled: true,
    });

    return new Set(holidays.map((holiday) => holiday.date));
  }

  // workingDates with the holidays already read.
  public workingDatesWithout(
    start: Date,
    end: Date,
    holidayDates: Set<string>,
  ): string[] {
    const dates: string[] = [];
    const current = new Date(start);

    while (current <= end) {
      const isWeekend = [0, 6].includes(current.getDay());
      const date = getDateOnly(current);

      if (!isWeekend && !holidayDates.has(date)) {
        dates.push(date);
      }

      current.setDate(current.getDate() + 1);
    }

    return dates;
  }
}
