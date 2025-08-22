import { Injectable } from '@nestjs/common';
import { HomeTabViewsService } from 'src/slack/services/slack-views/tab-views/home-tap-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { VacationsService } from 'src/vacations/vacations.service';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
export class HomeTabService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly homeTabViewService: HomeTabViewsService,
    private readonly userVacationsUsageService: UserVacationsUsageService,
    private readonly vacationsService: VacationsService,
  ) {}

  public async publishHomeTab(user: IUserViewModel) {
    const [userVacationsUsageInfo, requestedVacations] = await Promise.all([
      await this.userVacationsUsageService.getUserVacationsUsage(user),
      await this.vacationsService.findMany({
        userId: user.id,
        startDate: user.contract_start_date || undefined,
        status: VacationStatus.Requested,
      }),
    ]);

    await this.slackCommunicationService.publishView(
      this.homeTabViewService.getDefaultView({
        userId: user.slack_id,
        vacationDaysUsage: userVacationsUsageInfo,
        requestedVacations,
        isUserAdmin: user.role === UserRole.Admin,
      }),
      user.slack_team_id,
    );
  }

  public async publishEditRequestsTab(user: IUserViewModel) {
    await this.slackCommunicationService.publishView(
      this.homeTabViewService.getEditRequestsView({
        userId: user.slack_id,
      }),
      user.slack_team_id,
    );
  }
}
