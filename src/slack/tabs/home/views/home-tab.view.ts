import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IVacationPeriodUsageData } from 'src/vacation-requests/services/vacation-usage.service';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';

interface IGetViewParams extends IBaseTabViewParams {
  vacationUsageInfo: IVacationPeriodUsageData;
  requestedVacations?: IVacationRequestViewModel[];
}

export enum HomeTabActionId {
  OpenVacationModal = 'open_vacation_modal',
  ViewHistory = 'view_history',
  CancelRequest = 'cancel_vacation_request',
  ManagePendingRequestMenu = 'manage_pending_request_menu',
}

@Injectable()
export class HomeTabView extends BaseAdminTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.HomeTabView;
  protected activeTabActionId = AdminNavigationActionId.ViewHome;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  public getContentBlocks({
    vacationUsageInfo,
    requestedVacations,
  }: IGetViewParams) {
    return [...this.getUserViewBlocks(vacationUsageInfo, requestedVacations)];
  }

  protected getTabTitle() {
    return `*🏝 Welcome to Marina Bot*\nHere you can track and request your vacations.`;
  }

  private getUserViewBlocks(
    usageInfo: IVacationPeriodUsageData,
    requestedVacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    return [
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
            text: { type: 'plain_text', text: '📜 Vacation History' },
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
          action_id: HomeTabActionId.ManagePendingRequestMenu,
          options: [
            {
              text: { type: 'plain_text', text: '❌ Cancel' },
              value: `${HomeTabActionId.CancelRequest}:${vacation.id}`,
            },
          ],
        },
      });
    });

    return blocks;
  }
}
