import { Injectable } from '@nestjs/common';
import {
  IVacationPeriodUsageData,
  VacationsUsageService,
} from 'src/vacation-requests/services/vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { VacationRequestFormModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { getVacationTypeIcon } from 'src/common/utils/get-vacation-type-icon';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { CancelVacationRequestSelectModalView } from 'src/slack/tabs/home/views/cancel-vacation-request-select-modal.view';

export enum VacationCommand {
  Usage = 'usage',
  Request = 'request',
  Cancel = 'cancel',
}

@Injectable()
export default class VacationCommandService {
  public constructor(
    private readonly userVacationUsageService: VacationsUsageService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestFormModalView,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly cancelVacationRequestModalView: CancelVacationRequestSelectModalView,
  ) {}

  public async handleCommand(
    subcommand: VacationCommand | unknown,
    user: IUserViewModel,
    triggerId?: string,
  ) {
    switch (subcommand) {
      case VacationCommand.Usage: {
        const usageData =
          await this.userVacationUsageService.getCurrentVacationPeriodUsage(
            user,
          );

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getUserVacationsInfoMessage(usageData),
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
        const pendingRequests = await this.vacationRequestsService.findMany({
          userId: user.id,
          slackTeamId: user.slack_team_id,
          status: VacationRequestStatus.Pending,
        });

        if (pendingRequests.length === 0) {
          await this.slackCommunicationService.postEphemeral(
            user.slack_id,
            { text: 'You have no vacation requests waiting for approval.' },
            user.slack_team_id,
          );

          break;
        }

        await this.slackCommunicationService.openView(
          triggerId || user.slack_id,
          this.cancelVacationRequestModalView.getView({
            requests: pendingRequests,
          }),
          user.slack_team_id,
        );

        break;
      }
      default:
        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          {
            text: `Unknown command. Use \`/vacations (${Object.values(VacationCommand).join('|')})\`.`,
          },
          user.slack_team_id,
        );
    }
  }

  private getUserVacationsInfoMessage(
    usageData: IVacationPeriodUsageData | null,
  ) {
    if (!usageData) {
      return {
        text: 'No vacation usage data available.',
      };
    }

    const { usage } = usageData;

    return {
      text: `
📊 Your vacation usage:

${getVacationTypeIcon(VacationType.AnnualLeave)} Annual Leave:
   • Used: ${usage.annual_leave.used} days
   • Remaining: ${usage.annual_leave.available} days
   • Working days used: ${usage.annual_leave.working_days_used}
   • Working days remaining: ${usage.annual_leave.working_days_available}

${getVacationTypeIcon(VacationType.BonusDay)} Bonus Days:
   • Used: ${usage.bonus_day.used} days
   • Remaining: ${usage.bonus_day.available} days

${getVacationTypeIcon(VacationType.SickLeave)} Sick Leave:
   • Used: ${usage.sick_leave.used} days

${getVacationTypeIcon(VacationType.UnpaidLeave)}️ Unpaid Leave:
   • Used: ${usage.unpaid_leave.used} days

${getVacationTypeIcon(VacationType.Other)} Other:
   • Used: ${usage.other.used} days
`,
    };
  }
}
