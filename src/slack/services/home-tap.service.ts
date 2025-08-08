import { Injectable } from '@nestjs/common';
import { HomeTabViewService } from 'src/slack/services/slack-views/home-tap-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';

@Injectable()
export class HomeTabService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly homeTabViewService: HomeTabViewService,
    private readonly userVacationsUsageService: UserVacationsUsageService,
  ) {}

  public async publishHomeTab(user: IUserViewModel) {
    const userVacationsUsageInfo =
      await this.userVacationsUsageService.getUserVacationsUsage(user);

    await this.slackCommunicationService.publishView(
      this.homeTabViewService.getView(user.slack_id, userVacationsUsageInfo),
      user.team_id,
    );
  }
}
