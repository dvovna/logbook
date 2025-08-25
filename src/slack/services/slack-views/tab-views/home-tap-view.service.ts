import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationViewModel } from 'src/vacations/types/vacation.interface';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';

interface IGetViewParams {
  userId: string;
  isUserAdmin?: boolean;
  vacationDaysUsage: IUserVacationsUsageInfo;
  requestedVacations?: IVacationViewModel[];
}

@Injectable()
export class HomeTabViewsService {
  public getDefaultView({
    userId,
    vacationDaysUsage,
    requestedVacations,
    isUserAdmin,
  }: IGetViewParams) {
    return this.getBaseViewData(userId, [
      ...(isUserAdmin ? this.getAdminPanelBlocks() : []),
      ...this.getUserViewBlocks(vacationDaysUsage, requestedVacations),
    ]);
  }

  public getEditRequestsView({ userId }) {
    return this.getBaseViewData(userId, this.getRequestsBlocks());
  }

  private getBaseViewData(userId: string, blocks: AnyBlock[]) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        callback_id: ViewCallbackId.HomeTabView,
        blocks,
      },
    } as ViewsPublishArguments;
  }

  private getAdminPanelBlocks(): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⚙ Admin Panel*\nManage teams, vacation requests and policies.',
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Manage Users' },
            action_id: ViewActionId.AdminManageUsers,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Manage Teams' },
            action_id: ViewActionId.AdminManageTeams,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Vacation Requests' },
            action_id: ViewActionId.AdminViewAndEditVacationRequests,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Vacation Policies' },
            action_id: ViewActionId.AdminViewAndEditVacationPolicies,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Tip: Configure different vacation rules for each team._',
          },
        ],
      },
      { type: 'divider' },
    ];
  }

  private getRequestsBlocks(): AnyBlock[] {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*📅 Vacation Requests*' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Belarus: 24 vacation days, 5 bonus days\nPoland: 26 vacation days, 3 bonus days',
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '➕ Add Request' },
            action_id: 'admin_add_policy',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '⬅ Back' },
            action_id: ViewActionId.BackToHomeTap,
          },
        ],
      },
      { type: 'divider' },
    ];
  }

  private getUserViewBlocks(
    usage: IUserVacationsUsageInfo,
    requestedVacations?: IVacationViewModel[],
  ): AnyBlock[] {
    return [
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
            action_id: ViewActionId.OpenVacationModal,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📜 View History (Coming)' },
            action_id: ViewActionId.ViewHistory,
          },
        ],
      },
    ];
  }

  private getVacationUsageBlocks(usage: IUserVacationsUsageInfo): AnyBlock[] {
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
          text: { type: 'mrkdwn', text: '_No active vacation requests._' },
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
