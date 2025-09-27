import { Injectable } from '@nestjs/common';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { AnyBlock } from '@slack/web-api';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import capitalize from 'src/common/utils/capitalize';
import { IVacationPeriodUsageData } from 'src/vacation-requests/services/vacation-usage.service';
import { getVacationTypeIcon } from 'src/common/utils/get-vacation-type-icon';

interface IGetParams extends IBaseModalViewParams {
  user: IUserViewModel;
  usage: IVacationPeriodUsageData | null;
}

@Injectable()
export class UserVacationUsageModalView extends BaseModalView<IGetParams> {
  protected callbackId = ViewCallbackId.ViewUserVacationUsage;

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
    ];

    for (const type of Object.values(VacationType)) {
      const typeUsage = usage.usage[type];

      if (!typeUsage.used) {
        continue;
      }

      const emoji = getVacationTypeIcon[type];
      const lines: string[] = [`${emoji} *${capitalize(type)}*`];

      if ('used' in typeUsage && 'available' in typeUsage) {
        lines.push(
          `• Used: *${typeUsage.used}* / Available: *${typeUsage.available}*`,
        );
      }
      if (
        'working_days_used' in typeUsage &&
        'working_days_available' in typeUsage
      ) {
        lines.push(
          `• Working days used: *${typeUsage.working_days_used}* / Available: *${typeUsage.working_days_available}*`,
        );
      }

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      });
    }

    return blocks;
  }
}
