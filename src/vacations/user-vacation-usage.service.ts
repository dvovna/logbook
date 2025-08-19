import { VacationsService } from 'src/vacations/vacations.service';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import TeamsService from 'src/teams/teams.service';

@Injectable()
export class UserVacationsUsageService {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly vacationsService: VacationsService,
    private readonly vacationPoliciesService: VacationPoliciesService,
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

    const userTeam = await this.teamsService.findOne({
      id: user.team_id,
      slackTeamId: user.slack_team_id,
    });

    if (!userTeam) {
      throw new Error('User team not found.');
    }

    const teamVacationPolicy = await this.vacationPoliciesService.findOne({
      id: userTeam.vacation_policy_id,
      slackTeamId: user.slack_team_id,
    });

    if (!teamVacationPolicy) {
      throw new Error(`Vacation policy for team ${user.team_id} not found.`);
    }

    const result: IUserVacationsUsageInfo = {
      annual_leave: { used: 0, available: teamVacationPolicy.vacation_days },
      bonus_day: { used: 0, available: teamVacationPolicy.bonus_days },
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
