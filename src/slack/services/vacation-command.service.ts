import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { balanceTitle } from '@modules/slack/common/views/data/labels';
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

const HELP_TEXT = [
  '*/vacations* handles your time off:',
  '• `/vacations request`: request time off',
  '• `/vacations usage`: see how many days you have left',
  '• `/vacations cancel`: cancel a request that is still waiting for approval',
  'Everything else is on the *Home* tab of Logbook.',
].join('\n');

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
      default: {
        // `/vacations` on its own, `/vacations help` or a typo.
        const isHelp = !subcommand || subcommand === 'help';

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          {
            text: isHelp ? HELP_TEXT : `Unknown command.\n${HELP_TEXT}`,
          },
          user.slack_team_id,
        );
      }
    }
  }

  private getUserVacationsInfoMessage(usageData: IVacationPeriodUsageData) {
    const { usage, limits, periodStart, periodEnd } = usageData;
    // Without a team vacation policy nothing is limited, so there is nothing to show as remaining.
    const remaining = (days: number) =>
      limits ? `${days} days` : 'not limited';

    return {
      text: `
📊 Your vacation usage for ${formatDateRange(periodStart, periodEnd)}:

${balanceTitle(VacationType.AnnualLeave)}:
   • Used: ${usage.annual_leave.used} days
   • Remaining: ${remaining(usage.annual_leave.available)}
   • Working days used: ${usage.annual_leave.working_days_used}
   • Working days remaining: ${remaining(usage.annual_leave.working_days_available)}

${balanceTitle(VacationType.BonusDay)}:
   • Used: ${usage.bonus_day.used} days
   • Remaining: ${remaining(usage.bonus_day.available)}

${balanceTitle(VacationType.SickLeave)}:
   • Used: ${usage.sick_leave.used} days

${balanceTitle(VacationType.UnpaidLeave)}:
   • Used: ${usage.unpaid_leave.used} days

${balanceTitle(VacationType.Other)}:
   • Used: ${usage.other.used} days
`,
    };
  }
}
