import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationViewModel } from 'src/vacations/types/vacation.interface';

interface IViewData {
  usage: IUserVacationsUsageInfo;
  requestedVacations?: IVacationViewModel[];
}

@Injectable()
export class HomeTabViewService {
  public getView(
    userId: string,
    { usage, requestedVacations }: IViewData,
  ): ViewsPublishArguments {
    return {
      user_id: userId,
      view: {
        type: 'home',
        callback_id: ViewCallbackId.HomeTab,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*🏝 Welcome to Marina Bot*\nHere you can track and request your vacations.`,
            },
          },
          { type: 'divider' },
          ...this.getVacationUsageBlocks(usage),
          { type: 'divider' },
          ...this.getRequestedVacationsBlocks(requestedVacations),
          { type: 'divider' },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '➕ Request Vacation' },
                style: 'primary',
                action_id: 'open_vacation_modal',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '📜 View History(Coming)' },
                action_id: 'view_history',
              },
            ],
          },
        ],
      },
    };
  }

  private getVacationUsageBlocks(usage: IUserVacationsUsageInfo) {
    const optionalBlocks: AnyBlock[] = [];

    if (usage.sick_leave.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🤒 Sick Leave*\n*Used:* ${usage.sick_leave.used} days`,
        },
      });
    }

    if (usage.unpaid_leave.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚫 Unpaid Leave*\n*Used:* ${usage.unpaid_leave.used} days`,
        },
      });
    }

    if (usage.other.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📌 Other*\n*Used:* ${usage.other.used} days`,
        },
      });
    }

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📅 Annual Leave*\n*Used:* ${usage.annual_leave.used} days\n*Available:* ${usage.annual_leave.available} days`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎁 Bonus Days*\n*Used:* ${usage.bonus_day.used} days\n*Available:* ${usage.bonus_day.available} days`,
        },
      },
      ...optionalBlocks,
    ];
  }

  private getRequestedVacationsBlocks(
    vacations?: IVacationViewModel[],
  ): AnyBlock[] {
    if (!vacations?.length) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_No active vacation requests._',
          },
        },
      ];
    }

    const blocks: AnyBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📝 Active Vacation Requests:*',
        },
      },
    ];

    vacations.forEach((vacation) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${vacation.startDate} – ${vacation.endDate}* (${vacation.type})\n*Days:* ${vacation.days}\n`,
        },
        accessory: {
          type: 'overflow',
          action_id: `vacation_actions_${vacation.id}`,
          options: [
            {
              text: { type: 'plain_text', text: '✏ Edit' },
              value: `edit_${vacation.id}`,
            },
            {
              text: { type: 'plain_text', text: '❌ Cancel' },
              value: `cancel_${vacation.id}`,
            },
          ],
        },
      });
    });

    return blocks;
  }
}
