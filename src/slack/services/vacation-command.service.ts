import { Injectable } from '@nestjs/common';
import {
  IVacationPeriodUsageData,
  VacationsUsageService,
} from '@modules/vacation-requests/services/vacation-usage.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { getVacationTypeIcon } from '@common/utils/get-vacation-type-icon';
import VacationType from '@common/enums/vacation-type.enum';
import { VacationRequestModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-request-modal.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { CancelVacationRequestSelectModalView } from '@modules/slack/tabs/home/views/cancel-vacation-request-select-modal.view';

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
    private readonly vacationRequestModalService: VacationRequestModalService,
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
          await this.vacationRequestModalService.getModal({
            user,
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
          statuses: [VacationRequestStatus.Pending],
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

  private getUserVacationsInfoMessage(usageData: IVacationPeriodUsageData) {
    const { usage, limits, periodStart, periodEnd } = usageData;
    // Without a team vacation policy nothing is limited, so there is nothing to show as remaining.
    const remaining = (days: number) =>
      limits ? `${days} days` : 'not limited';

    return {
      text: `
📊 Your vacation usage for ${periodStart.toDateString()} – ${periodEnd.toDateString()}:

${getVacationTypeIcon(VacationType.AnnualLeave)} Annual Leave:
   • Used: ${usage.annual_leave.used} days
   • Remaining: ${remaining(usage.annual_leave.available)}
   • Working days used: ${usage.annual_leave.working_days_used}
   • Working days remaining: ${remaining(usage.annual_leave.working_days_available)}

${getVacationTypeIcon(VacationType.BonusDay)} Bonus Days:
   • Used: ${usage.bonus_day.used} days
   • Remaining: ${remaining(usage.bonus_day.available)}

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
