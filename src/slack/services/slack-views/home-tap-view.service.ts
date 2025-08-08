import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

@Injectable()
export class HomeTabViewService {
  public getView(
    userId: string,
    viewData: IUserVacationsUsageInfo,
  ): ViewsPublishArguments {
    const optionalBlocks: AnyBlock[] = [];

    if (viewData.sick_leave.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🤒 Sick Leave*\n*Used:* ${viewData.sick_leave.used} days`,
        },
      });
    }

    if (viewData.unpaid_leave.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚫 Unpaid Leave*\n*Used:* ${viewData.unpaid_leave.used} days`,
        },
      });
    }

    if (viewData.other.used > 0) {
      optionalBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📌 Other*\n*Used:* ${viewData.other.used} days`,
        },
      });
    }

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
              text: `*🏝 Welcome to Vacation Manager*\nHere you can track and request your vacations.`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*📅 Annual Leave*\n*Used:* ${viewData.annual_leave.used} days\n*Available:* ${viewData.annual_leave.available} days`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*🎁 Bonus Days*\n*Used:* ${viewData.bonus_day.used} days\n*Available:* ${viewData.bonus_day.available} days`,
            },
          },
          ...optionalBlocks,
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
                text: { type: 'plain_text', text: '📜 View History' },
                action_id: 'view_history',
              },
            ],
          },
        ],
      },
    };
  }
}
