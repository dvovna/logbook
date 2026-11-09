import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { getDisplayTime } from '@common/utils/time.utils';
import { formatDateRange } from '@common/utils/date.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { IWorkspaceTimeSummary } from 'src/time-entries/services/time-entries-summary.service';
import { IBillingReport } from 'src/time-entries/services/billing-report.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { Divider } from '@modules/slack/common/views/components/separator';
import {
  canOpenScreen,
  ScreenId,
  SCREENS,
} from '@modules/slack/common/navigation/screens';

export interface IReportsTabMetadata {
  // The billing report on show, from its form.
  report?: { clientId: string; fromDate: string; toDate: string };
}

interface IGetViewParams extends IBaseTabViewParams {
  weekSummary: IWorkspaceTimeSummary;
  billingReport: IBillingReport | null;
}

// A table holds 100 rows: the header and 99 lines.
const TABLE_LINES = 99;

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

const cell = (text: string) => ({ type: 'raw_text', text });

// The week at a glance (a manager's teams only); for Admin and HR also the
// billing report and everyone's time.
@Injectable()
export class ReportsTabView extends BaseTabView<
  IGetViewParams,
  IReportsTabMetadata
> {
  protected callbackId = ViewCallbackId.ReportsTabView;

  protected getTabTitle(): string {
    return `*${SCREENS[ScreenId.Reports].title}*`;
  }

  protected getContentBlocks({
    weekSummary,
    billingReport,
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
      ...(billingReport ? this.getBillingReportBlocks(billingReport) : []),
    ];
  }

  // Approved time of a client's projects: a table by project, and who
  // worked on them.
  private getBillingReportBlocks(report: IBillingReport): AnyBlock[] {
    const summary: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Billing report: ${escapeMrkdwn(report.clientName)}* · ${formatDateRange(report.fromDate, report.toDate)}\n` +
          `Approved: *${hours(report.approvedMinutes)}*, billable *${hours(report.billableMinutes)}*` +
          (report.unapprovedMinutes
            ? `\n_Not approved yet: ${hours(report.unapprovedMinutes)}_`
            : ''),
      },
    };

    if (!report.approvedMinutes) {
      return [
        ...Divider.getBlocks(),
        summary,
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_No approved time for this client in this period._',
            },
          ],
        },
      ];
    }

    const projects = report.byProject.slice(0, TABLE_LINES);
    const left = report.byProject.length - projects.length;

    return [
      ...Divider.getBlocks(),
      summary,
      {
        type: 'table',
        column_settings: [
          { is_wrapped: true },
          { align: 'right' },
          { align: 'right' },
        ],
        rows: [
          [cell('Project'), cell('Hours'), cell('Billable')],
          ...projects.map(({ name, minutes, billableMinutes }) => [
            cell(name),
            cell(hours(minutes)),
            cell(hours(billableMinutes)),
          ]),
        ],
      } as unknown as AnyBlock,
      ...(left
        ? [
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `_and ${left} more projects_` },
              ],
            } as AnyBlock,
          ]
        : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*By person*\n${report.byPerson
            .map(
              ({ name, minutes }) =>
                `• ${escapeMrkdwn(name)} — ${hours(minutes)}`,
            )
            .join('\n')}`,
        },
      },
    ];
  }
}
