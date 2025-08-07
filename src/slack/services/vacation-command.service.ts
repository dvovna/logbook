import { Injectable } from '@nestjs/common';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';

export enum VacationCommand {
  Usage = 'usage',
  Request = 'request',
  Cancel = 'cancel',
}

@Injectable()
export default class VacationCommandService {
  public constructor(
    private readonly userVacationUsageService: UserVacationsUsageService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
  ) {}

  public async handleCommand(
    subcommand: VacationCommand | unknown,
    user: IUserViewModel,
    triggerId?: string,
  ) {
    switch (subcommand) {
      case VacationCommand.Usage: {
        const usageInfo =
          await this.userVacationUsageService.getUserVacationsUsage(user);

        await this.slackCommunicationService.postMessage(
          user.slack_id,
          this.getUserVacationsInfoMessage(usageInfo),
          user.team_id,
        );

        break;
      }
      case VacationCommand.Request: {
        await this.slackCommunicationService.openView(
          user.slack_id,
          this.vacationRequestViewService.getView(triggerId || user.slack_id, {
            userId: user.id,
            teamId: user.team_id,
          }),
          user.team_id,
        );

        break;
      }
      case VacationCommand.Cancel: {
        break;
      }
      default:
        await this.slackCommunicationService.postMessage(
          user.slack_id,
          {
            text: `Unknown command. Use \`/vacation (${Object.values(VacationCommand).join('|')})\`.`,
          },
          user.team_id,
        );
    }
  }

  private getUserVacationsInfoMessage(usageInfo: IUserVacationsUsageInfo) {
    return {
      text: `
        📊 Your vacation usage:

        ✅ Annual Leave:
           • Used: ${usageInfo.annual_leave.used} days
           • Remaining: ${usageInfo.annual_leave.available} days

        ✨ Bonus Days:
           • Used: ${usageInfo.bonus_day.used} days
           • Remaining: ${usageInfo.bonus_day.available} days

        🩺 Sick Leave:
           • Used: ${usageInfo.sick_leave.used} days

        ℹ️ Note: Only approved vacations are counted in usage.
      `,
    };
  }
}
