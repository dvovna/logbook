import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { getDisplayTime } from '@common/utils/time.utils';
import { IWorkspaceTimeSummary } from 'src/time-entries/services/time-entries-summary.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  canOpenScreen,
  ScreenId,
} from '@modules/slack/common/navigation/screens';

interface IGetViewParams extends IBaseTabViewParams {
  weekSummary: IWorkspaceTimeSummary;
}

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

// The week at a glance (a manager's teams only); for Admin and HR also the
// billing report and everyone's time.
@Injectable()
export class ReportsTabView extends BaseTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.ReportsTabView;

  protected getTabTitle(): string {
    return '*📊 Reports*';
  }

  protected getContentBlocks({
    weekSummary,
    userRole,
  }: IGetViewParams): AnyBlock[] {
    const week: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*This week*',
          `*${hours(weekSummary.weekMinutes)}* logged · *${hours(weekSummary.weekBillableMinutes)}* billable · *${weekSummary.activeProjects}* active projects`,
        ].join('\n'),
      },
    };

    if (!canOpenScreen(ScreenId.TimeLogs, userRole)) {
      return [week];
    }

    return [
      week,
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📊 Billing report' },
            style: 'primary',
            action_id: ReportsTabActionId.BillingReport,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '⏱ Time logs' },
            action_id: NavigationActionId.TimeLogs,
          },
        ],
      },
    ];
  }
}
