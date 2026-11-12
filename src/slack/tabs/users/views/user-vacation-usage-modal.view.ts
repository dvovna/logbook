import { balanceTitle } from '@modules/slack/common/views/data/labels';
import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { AnyBlock } from '@slack/web-api';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import {
  correctionDetails,
  fileBalanceLine,
} from '@modules/slack/common/views/data/leave-balance.text';

interface IGetParams extends IBaseModalViewParams {
  user: IUserViewModel;
  usage: IVacationPeriodUsageData | null;
  fileBalance: ILeaveBalance | null;
}

const NO_LIMIT_TEXT = 'No limit: no vacation policy applies to this person';
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

  protected getViewBlocks({
    user,
    usage,
    fileBalance,
  }: IGetParams): AnyBlock[] {
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
            text: `*User:* ${escapeMrkdwn(user.name)} (<@${user.slack_id}>)`,
          },
          {
            type: 'mrkdwn',
            text: `*Period:* ${formatDateRange(usage.periodStart, usage.periodEnd)}`,
          },
        ],
      },
      { type: 'divider' },
      this.buildAnnualLeaveBlock(usage.usage.annual_leave, usage.limits),
    ];

    if (fileBalance && usage.limits?.correction) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: fileBalanceLine(fileBalance) }],
      });
    }

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
    const limit = limits?.vacationDays;
    const carryover = limits?.carryoverDays ?? 0;

    let usedText = `Used: *${usedDays}* days`;
    if (workingUsed > 0 && workingUsed !== usedDays) {
      usedText += ` (*${workingUsed}* working)`;
    }

    let availableText = NO_LIMIT_TEXT;

    if (limits) {
      availableText = `Available: *${available}*`;

      if (workingAvailable > 0 && workingAvailable !== available) {
        availableText += ` (*${workingAvailable}* working)`;
      }

      availableText += ` / Limit: *${limit}* days`;

      if (carryover > 0) {
        availableText += ` (+*${carryover}* carryover)`;
      }

      const corrections = correctionDetails(limits.correction, {
        days: true,
        workingDays: true,
      });

      if (corrections.length) {
        availableText += ` (${corrections.join(', ')})`;
      }
    }

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${balanceTitle(VacationType.AnnualLeave)}*\n\n${usedText}\n${availableText}`,
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
    const corrections = correctionDetails(limits?.correction, {
      bonusDays: true,
    });

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${balanceTitle(VacationType.BonusDay)}*\n\nUsed: *${used}* days\n${
          limits
            ? `Available: *${available}* / Limit: *${limit}* days${corrections.length ? ` (${corrections.join(', ')})` : ''}`
            : NO_LIMIT_TEXT
        }`,
      },
    } as AnyBlock;
  }

  private buildSimpleLeaveBlock(type: VacationType, used: number) {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${balanceTitle(type)}*\nUsed: *${used}* days`,
      },
    } as AnyBlock;
  }
}
