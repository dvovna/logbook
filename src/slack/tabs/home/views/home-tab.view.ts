import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/services/vacation-usage.service';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import VacationType from '@common/enums/vacation-type.enum';
import * as pluralize from 'pluralize';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';

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
  LogTime = 'log_time',
  EditEntries = 'edit_time',
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
    return `*Marina Bot*\n`;
  }

  private getUserViewBlocks(
    usageInfo: IVacationPeriodUsageData | null,
    requestedVacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    return [
      { type: 'section', text: { type: 'plain_text', text: 'Your personal work & vacation overview' } },
      ...SeparatorComponent.getBlocks(),
      ...this.getTimeTrackingBlocks(),
      ...this.getVacationUsageBlocks(usageInfo),
      ...this.getRequestedVacationsBlocks(requestedVacations),
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
    const limit = limits?.vacationDays ?? '-';
    const carryover = limits?.carryoverDays ?? 0;

    const details: string[] = [];

    if (usedDays > 0) {
      details.push(`*${usedDays}* used`);
    }

    if (workingUsed > 0 && workingUsed !== usedDays) {
      details.push(`*${workingUsed}* working`);
    }

    if (carryover > 0) {
      details.push(`+*${carryover}* carryover`);
    }

    const detailsText = details.length ? ` (${details.join(', ')})` : '';

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Annual leave: *${available} available* / ${limit} total${detailsText}`,
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

    const details: string[] = [];

    if (used > 0) {
      details.push(`*${used}* used`);
    }

    const detailsText = details.length ? ` (${details.join(', ')})` : '';

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Bonus Days: *${available} available* / ${limit} total ${detailsText}`,
      },
    } as AnyBlock;
  }


  private getVacationUsageBlocks(
    vacationsUsageInfo: IVacationPeriodUsageData | null,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🏝 Vacation Usage*' },
      },
    ];

    if (!vacationsUsageInfo) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No vacation usage data available._',
        },
      });

      return blocks;
    }

    blocks.push(
      this.buildAnnualLeaveBlock(
        vacationsUsageInfo.usage.annual_leave,
        vacationsUsageInfo.limits,
      ),
    );

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
        const title = VACATION_TYPE_DISPLAY_NAME_MAP[type];

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${title}: *${leave.used}* used`,
          },
        });
      }
    });

    return blocks;
  }

  private buildVacationBlock(vacation: IVacationRequestViewModel): AnyBlock {
    const start = new Date(vacation.start_date);
    const end = new Date(vacation.end_date);
    const isSameDay = start.getDate() === end.getDate() && start.getMonth() === end.getMonth();
    const isSameMonth = start.getMonth() === end.getMonth();
    const startStr = isSameMonth
      ? start.getDate()
      : `${start.getDate()} ${start.toLocaleString('en-US', { month: 'short' })}`;
    const endStr = isSameDay
      ? `${end.toLocaleString('en-US', { month: 'short' })}`
      : `- ${end.getDate()} ${end.toLocaleString('en-US', { month: 'short' })}`;

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${VACATION_TYPE_DISPLAY_NAME_MAP[vacation.type]}*\n${startStr} ${endStr} (${pluralize('day', vacation.days, true)})`,
      },
      accessory: {
        type: 'overflow',
        action_id: HomeTabActionId.ManagePendingRequestMenu,
        options: [
          {
            text: { type: 'plain_text', text: '📋 View Details' },
            value: `${HomeTabActionId.ViewDetails}:${vacation.id}`,
          },
          {
            text: { type: 'plain_text', text: '❌ Cancel' },
            value: `${HomeTabActionId.CancelRequest}:${vacation.id}`,
          },
        ],
      },
    } as AnyBlock;
  }

  private getRequestedVacationsBlocks(
    vacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    if (!vacations?.length) {
      return [];
    }

    return [
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🗓 Your Pending Vacation Requests*' },
      },
      ...vacations.map((data) => this.buildVacationBlock(data)),
    ];
  }

  private getTimeTrackingBlocks(): AnyBlock[] {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🕒 Time Tracking*' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Today: 4h [Client A], 2h [Client B]`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'This week: 20h total',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '➕ Log Time' },
            style: 'primary',
            action_id: 'log_time',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit Entries' },
            action_id: 'edit_time',
          },
        ],
      },
      { type: 'divider' },
    ];
  }
}
