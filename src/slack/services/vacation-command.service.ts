import { Injectable } from '@nestjs/common';
import { UserVacationsUsageService } from 'src/vacation-requests/services/user-vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IVacationUsageByType } from 'src/vacation-requests/types/user-vacations-usage-info.interface';
import { VacationRequestModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

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
    private readonly vacationRequestViewService: VacationRequestModalView,
  ) {}

  public async handleCommand(
    subcommand: VacationCommand | unknown,
    user: IUserViewModel,
    triggerId?: string,
  ) {
    switch (subcommand) {
      case VacationCommand.Usage: {
        const { usage } =
          await this.userVacationUsageService.getCurrentVacationPeriodUsage(
            user,
          );

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getUserVacationsInfoMessage(usage),
          user.slack_team_id,
        );

        break;
      }
      case VacationCommand.Request: {
        await this.slackCommunicationService.openView(
          triggerId || user.slack_id,
          this.vacationRequestViewService.getView({
            callbackId: ViewCallbackId.UserVacationRequest,
          }),
          user.slack_team_id,
        );

        break;
      }
      case VacationCommand.Cancel: {
        break;
      }
      default:
        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          {
            text: `Unknown command. Use \`/vacation (${Object.values(VacationCommand).join('|')})\`.`,
          },
          user.slack_team_id,
        );
    }
  }

  private getUserVacationsInfoMessage(usageInfo: IVacationUsageByType) {
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
