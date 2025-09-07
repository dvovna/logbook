import { Injectable } from '@nestjs/common';
import HolidaysService from 'src/holidays/services/holidays.service';
import { getDateOnly } from 'src/common/utils/date.utils';

@Injectable()
export class VacationDaysCalculationService {
  public constructor(private readonly holidaysService: HolidaysService) {}

  public async calculate(
    start: Date,
    end: Date,
    vacationPolicyId: string,
    slackTeamId: string,
  ): Promise<number> {
    const holidays = await this.holidaysService.findMany({
      slackTeamId,
      vacationPolicyId,
      startDate: start,
      endDate: end,
      excludeDisabled: true,
    });

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
}
