import { Injectable } from '@nestjs/common';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import { ViewsOpenArguments } from '@slack/web-api/dist/types/request/views';
import { IntegrationCallbackId } from 'src/slack/enums/integration-callback-id.enum';

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
          this.getUserRequestVacationView(triggerId || user.slack_id),
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

  public getUserRequestVacationView(triggerId: string): ViewsOpenArguments {
    return {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: IntegrationCallbackId.CreateVacationRequest,
        title: { type: 'plain_text', text: 'Request Vacation' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'start_date_block',
            label: { type: 'plain_text', text: 'Start Date' },
            element: {
              type: 'datepicker',
              action_id: 'start_date',
              placeholder: { type: 'plain_text', text: 'Select a date' },
            },
          },
          {
            type: 'input',
            block_id: 'end_date_block',
            label: { type: 'plain_text', text: 'End Date' },
            element: {
              type: 'datepicker',
              action_id: 'end_date',
              placeholder: { type: 'plain_text', text: 'Select a date' },
            },
          },
          {
            type: 'input',
            block_id: 'type_block',
            label: { type: 'plain_text', text: 'Vacation Type' },
            element: {
              type: 'static_select',
              action_id: 'type',
              options: [
                {
                  text: { type: 'plain_text', text: 'Annual Leave' },
                  value: 'annual_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Bonus Day' },
                  value: 'bonus_day',
                },
                {
                  text: { type: 'plain_text', text: 'Sick Leave' },
                  value: 'sick_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Unpaid Leave' },
                  value: 'unpaid_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Other' },
                  value: 'other',
                },
              ],
            },
          },
          {
            type: 'input',
            optional: true,
            block_id: 'comment_block',
            label: { type: 'plain_text', text: 'Comment (optional)' },
            element: {
              type: 'plain_text_input',
              action_id: 'comment',
              multiline: true,
            },
          },
        ],
      },
    };
  }
}
