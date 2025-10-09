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
import { getVacationTypeIcon } from 'src/common/utils/get-vacation-type-icon';
import VacationType from 'src/common/enums/vacation-type.enum';

interface IGetViewParams extends IBaseTabViewParams {
  vacationUsageInfo: IVacationPeriodUsageData | null;
  requestedVacations?: IVacationRequestViewModel[];
}

export enum HomeTabActionId {
  OpenVacationModal = 'open_vacation_modal',
  ViewHistory = 'view_history',
  CancelRequest = 'cancel_vacation_request',
  ViewDetails = 'view_vacation_request_details',
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
    return `*🏝 Welcome to Marina Bot*\n\nHere you can track and request your vacations.`;
  }

  private getUserViewBlocks(
    usageInfo: IVacationPeriodUsageData | null,
    requestedVacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    return [
      ...this.getVacationUsageBlocks(usageInfo),
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
      ...this.getRequestedVacationsBlocks(requestedVacations),
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
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

  private buildAnnualLeaveBlock(
    usage: IVacationPeriodUsageData['usage']['annual_leave'],
    limits?: IVacationPeriodUsageData['limits'],
  ) {
    const usedDays = usage.used ?? 0;
    const workingUsed = usage.working_days_used ?? 0;
    const available = usage.available ?? 0;
    const workingAvailable = usage.working_days_available ?? 0;
    const limit = limits ? limits.vacationDays : '-';
    const carryover = limits?.carryoverDays ?? 0;

    let usedText = `Used: *${usedDays}* days`;

    if (workingUsed > 0 && workingUsed !== usedDays) {
      usedText += ` (*${workingUsed}* working)`;
    }

    let availableText = `Available: ${limits ? `*${available}* / Limit: *${limit}* days` : '-'}`;
    if (workingAvailable > 0 && workingAvailable !== available) {
      availableText += ` (*${workingAvailable}* working)`;
    }

    if (carryover > 0) {
      availableText += ` (+*${carryover}* carryover)`;
    }

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📅 Annual Leave*\n\n${usedText}\n${availableText}`,
      },
    } as AnyBlock;
  }

  private buildBonusDaysBlock(
    usage: IVacationPeriodUsageData['usage']['bonus_day'],
    limits?: IVacationPeriodUsageData['limits'],
  ) {
    const used = usage.used ?? 0;
    const available = usage.available ?? 0;
    const limit = limits?.bonusDays ?? 0;

    const lines: string[] = [
      `*🎁 Bonus Days*\n`,
      `Used: *${used}* days`,
      `Available: ${limits ? `*${available}* / Limit: *${limit}* days` : '-'}`,
    ];

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n'),
      },
    } as AnyBlock;
  }

  private getVacationUsageBlocks(
    vacationsUsageInfo: IVacationPeriodUsageData | null,
  ): AnyBlock[] {
    if (!vacationsUsageInfo) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_No vacation usage data available._',
          },
        },
      ];
    }

    const blocks: AnyBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Here's your vacation usage for the period *${vacationsUsageInfo.periodStart.toDateString()} – ${vacationsUsageInfo.periodEnd.toDateString()}*:`,
        },
      },
      this.buildAnnualLeaveBlock(
        vacationsUsageInfo.usage.annual_leave,
        vacationsUsageInfo.limits,
      ),
    ];

    if (
      vacationsUsageInfo.usage.bonus_day.used > 0 ||
      vacationsUsageInfo.usage.bonus_day.available > 0
    ) {
      blocks.push(
        this.buildBonusDaysBlock(
          vacationsUsageInfo.usage.bonus_day,
          vacationsUsageInfo.limits,
        ),
      );
    }

    [
      VacationType.SickLeave,
      VacationType.UnpaidLeave,
      VacationType.Other,
    ].forEach((type) => {
      const leave =
        vacationsUsageInfo.usage[type as keyof typeof vacationsUsageInfo.usage];

      if (leave.used > 0) {
        const emoji = getVacationTypeIcon(type);
        const title = VACATION_TYPE_DISPLAY_NAME_MAP[type];

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${emoji} ${title}*\nUsed: ${leave.used} days`,
          },
        });
      }
    });

    return blocks;
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
      const vacationType =
        VACATION_TYPE_DISPLAY_NAME_MAP[vacation.type] ?? 'Unknown';

      const overflowOptions = [
        {
          text: { type: 'plain_text', text: '📋 View Details' },
          value: `${HomeTabActionId.ViewDetails}:${vacation.id}`,
        },
        {
          text: { type: 'plain_text', text: '❌ Cancel' },
          value: `${HomeTabActionId.CancelRequest}:${vacation.id}`,
        },
      ];

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${vacation.start_date} – ${vacation.end_date}* (${vacationType})\n*Days:* ${vacation.days}`,
        },
        accessory: {
          type: 'overflow',
          action_id: HomeTabActionId.ManagePendingRequestMenu,
          options: overflowOptions,
        },
      } as AnyBlock);
    });

    return blocks;
  }
}
