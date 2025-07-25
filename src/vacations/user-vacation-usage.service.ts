import { VacationsService } from 'src/vacations/vacations.service';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';

@Injectable()
export class UserVacationsUsageService {
  public constructor(
    private readonly vacationsService: VacationsService,
    private readonly teamSettingsService: TeamSettingsService,
  ) {}

  public async getUserVacationsUsage(user: IUserViewModel) {
    if (!user.contract_start_date) {
      throw new Error(
        `User ${user.email} does not have a contract start date.`,
      );
    }

    const vacations = await this.vacationsService.findMany({
      userId: user.id,
      startDate: user.contract_start_date,
      status: VacationStatus.Approved,
    });

    const teamSettings = await this.teamSettingsService.getByTeamId(
      user.team_id,
    );

    if (!teamSettings) {
      throw new Error(`Team settings for team ${user.team_id} not found.`);
    }

    const result: IUserVacationsUsageInfo = {
      annual_leave: { used: 0, available: teamSettings.vacation_days },
      bonus_day: { used: 0, available: teamSettings.bonus_days },
      sick_leave: { used: 0 },
      unpaid_leave: { used: 0 },
      other: { used: 0 },
    };

    for (const vacation of vacations) {
      if (vacation.status !== VacationStatus.Approved) {
        continue;
      }

      const type = vacation.type;
      result[type].used += vacation.days;

      if (type === VacationType.AnnualLeave || type === VacationType.BonusDay) {
        result[type].available -= vacation.days;
      }
    }

    return result;
  }
}
