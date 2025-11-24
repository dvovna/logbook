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
    const holidays = vacationPolicyId
      ? await this.getHolidaysInRange(vacationPolicyId, slackTeamId, start, end)
      : [];

    const holidayDates = holidays.map((holiday) => holiday.date);

    let workingDays = 0;
    const current = new Date(start);

    while (current <= end) {
      const isWeekend = [0, 6].includes(current.getDay());
      const isHoliday = holidayDates.includes(getDateOnly(current));

      if (!isWeekend && !isHoliday) {
        workingDays++;
      }

      current.setDate(current.getDate() + 1);
    }

    return workingDays;
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
