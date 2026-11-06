import { Injectable } from '@nestjs/common';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { AnyBlock } from '@slack/web-api';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/services/vacation-usage.service';
import { getVacationTypeIcon } from '@common/utils/get-vacation-type-icon';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';

interface IGetParams extends IBaseModalViewParams {
  user: IUserViewModel;
  usage: IVacationPeriodUsageData | null;
}

@Injectable()
export class UserVacationUsageModalView extends BaseModalView<IGetParams> {
  protected defaultCallbackId = ViewCallbackId.ViewUserVacationUsage;

  protected getTitleText() {
    return `Vacation Period Usage`;
  }

  protected getActionButtons(): IActionButtons {
    return {
      close: { type: 'plain_text', text: 'Close' },
    };
  }

  protected getViewBlocks({ user, usage }: IGetParams): AnyBlock[] {
    if (!usage) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `No vacation usage data available for <@${user.slack_id}>.`,
          },
        },
      ];
    }

    const blocks: AnyBlock[] = [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*User:* ${user.name} (<@${user.slack_id}>)`,
          },
          {
            type: 'mrkdwn',
            text: `*Period:* ${usage.periodStart.toDateString()} → ${usage.periodEnd.toDateString()}`,
          },
        ],
      },
      { type: 'divider' },
      this.buildAnnualLeaveBlock(usage.usage.annual_leave, usage.limits),
    ];

    if (usage.usage.bonus_day.used > 0 || usage.usage.bonus_day.available > 0) {
      blocks.push(
        this.buildBonusDaysBlock(usage.usage.bonus_day, usage.limits),
      );
    }

    [
      VacationType.SickLeave,
      VacationType.UnpaidLeave,
      VacationType.Other,
    ].forEach((type) => {
      const leave = usage.usage[type];
      if (leave.used > 0) {
        blocks.push(this.buildSimpleLeaveBlock(type, leave.used));
      }
    });

    return blocks;
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

    let availableText = `Available: ${limits ? `*${available}*` : '-'}`;
    if (workingAvailable > 0 && workingAvailable !== available) {
      availableText += ` (*${workingAvailable}* working)`;
    }

    availableText += ` / Limit: *${limit}* days`;

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

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🎁 Bonus Days*\n\nUsed: *${used}* days\nAvailable: ${
          limits ? `*${available}* / Limit: *${limit}* days` : '-'
        }`,
      },
    } as AnyBlock;
  }

  private buildSimpleLeaveBlock(type: VacationType, used: number) {
    const emoji = getVacationTypeIcon(type);
    const title = VACATION_TYPE_DISPLAY_NAME_MAP[type];

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${emoji} ${title}*\nUsed: *${used}* days`,
      },
    } as AnyBlock;
  }
}
