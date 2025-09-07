import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IVacationPeriodUsageData } from 'src/vacation-requests/services/user-vacation-usage.service';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { BaseTabView } from 'src/slack/common/views/base-tab.view';
import { AdminPanelView } from 'src/slack/common/views/admin-panel.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';

interface IGetViewParams {
  userId: string;
  isUserAdmin?: boolean;
  vacationUsageInfo: IVacationPeriodUsageData;
  requestedVacations?: IVacationRequestViewModel[];
}

export enum HomeTabActionId {
  OpenVacationModal = 'open_vacation_modal',
  ViewHistory = 'view_history',
}

@Injectable()
export class HomeTabView extends BaseTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.HomeTabView;

  public getTabContentBlocks({
    vacationUsageInfo,
    requestedVacations,
    isUserAdmin,
  }: IGetViewParams) {
    return [
      ...(isUserAdmin
        ? AdminPanelView.getPanelBlocks(AdminNavigationActionId.ViewHome)
        : []),
      ...this.getUserViewBlocks(vacationUsageInfo, requestedVacations),
    ];
  }

  private getUserViewBlocks(
    usageInfo: IVacationPeriodUsageData,
    requestedVacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🏝 Welcome to Marina Bot*\nHere you can track and request your vacations.`,
        },
      },
      ...this.getVacationUsageBlocks(usageInfo),
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
            action_id: HomeTabActionId.OpenVacationModal,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📜 View History (Coming)' },
            action_id: HomeTabActionId.ViewHistory,
          },
        ],
      },
    ];
  }

  private getVacationUsageBlocks(
    vacationsUsageInfo: IVacationPeriodUsageData,
  ): AnyBlock[] {
    const optionalBlocks: AnyBlock[] = [];
    const { usage, periodStart, periodEnd } = vacationsUsageInfo;

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
          text: `Here's your vacation usage for the period ${periodStart.toDateString()} – ${periodEnd.toDateString()}:`,
        },
      },
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
    vacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    if (!vacations?.length) {
      return [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '_No pending vacation requests._' },
        },
      ];
    }

    const blocks: AnyBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*📝 Pending Approval Vacations:*' },
      },
    ];

    vacations.forEach((vacation) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${vacation.start_date} – ${vacation.end_date}* (${VACATION_TYPE_DISPLAY_NAME_MAP[vacation.type]})\n*Days:* ${vacation.days}\n`,
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
