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
import {
  IBillingReport,
  IBillingTotal,
} from 'src/time-entries/services/billing-report.service';
import { formatHourlyRate, formatMoney } from '@common/utils/money.utils';
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

// A table holds 100 rows (the header, the lines and the total) and 10000
// characters in its cells.
const MAX_TABLE_LINES = 98;
const MAX_TABLE_CHARACTERS = 10000;

// Lines of a "By project" or "By person" list.
const MAX_TOTALS = 40;

const NONE = '–';

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

  // Approved time of a client's projects: a table of who worked on which
  // project at what rate, with the total, then the same by project and by
  // person.
  private getBillingReportBlocks(report: IBillingReport): AnyBlock[] {
    const money = (cents: number) => formatMoney(cents, report.currency);
    const summary: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Billing report: ${escapeMrkdwn(report.clientName)}* · ${formatDateRange(report.fromDate, report.toDate)}`,
          `Approved: *${hours(report.approvedMinutes)}*, billable *${hours(report.billableMinutes)}* · Amount: *${money(report.amount)}*`,
          report.unratedMinutes &&
            `_No rate: ${hours(report.unratedMinutes)} of billable time, not in the amount_`,
          report.unapprovedMinutes &&
            `_Not approved yet: ${hours(report.unapprovedMinutes)}_`,
        ]
          .filter(Boolean)
          .join('\n'),
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

    const { rows, left } = this.getBillingTableRows(report);

    return [
      ...Divider.getBlocks(),
      summary,
      {
        type: 'table',
        column_settings: [
          { is_wrapped: true },
          { is_wrapped: true },
          { align: 'right' },
          { align: 'right' },
          { align: 'right' },
          { align: 'right' },
        ],
        rows: rows.map((row) => row.map(cell)),
      } as unknown as AnyBlock,
      ...(left
        ? [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `_and ${left} more lines, in the total_`,
                },
              ],
            } as AnyBlock,
          ]
        : []),
      this.getTotalsBlock('By project', report.byProject, money),
      this.getTotalsBlock('By person', report.byPerson, money),
    ];
  }

  // The header, as many lines as the table holds, and the total of all of
  // them.
  private getBillingTableRows(report: IBillingReport) {
    const money = (cents: number) => formatMoney(cents, report.currency);
    const header = ['Project', 'Person', 'Hours', 'Billable', 'Rate', 'Amount'];
    const total = [
      'Total',
      NONE,
      hours(report.approvedMinutes),
      hours(report.billableMinutes),
      NONE,
      money(report.amount),
    ];
    const lengthOf = (row: string[]) =>
      row.reduce((sum, text) => sum + text.length, 0);
    const rows = [header];
    let characters = lengthOf(header) + lengthOf(total);

    for (const line of report.lines) {
      const row = [
        line.projectName,
        line.personName,
        hours(line.minutes),
        hours(line.billableMinutes),
        line.hourlyRate === null
          ? NONE
          : formatHourlyRate(line.hourlyRate, report.currency),
        line.amount === null ? NONE : money(line.amount),
      ];

      if (
        rows.length > MAX_TABLE_LINES ||
        characters + lengthOf(row) > MAX_TABLE_CHARACTERS
      ) {
        break;
      }

      rows.push(row);
      characters += lengthOf(row);
    }

    return {
      rows: [...rows, total],
      left: report.lines.length - (rows.length - 1),
    };
  }

  // "• Website — 3h 15m · $390.00 · 1h with no rate", most time first.
  private getTotalsBlock(
    title: string,
    totals: IBillingTotal[],
    money: (cents: number) => string,
  ): AnyBlock {
    const lines = totals
      .slice(0, MAX_TOTALS)
      .map(({ name, minutes, amount, unratedMinutes }) =>
        [
          `• ${escapeMrkdwn(name)} — ${hours(minutes)}`,
          amount && money(amount),
          unratedMinutes && `${hours(unratedMinutes)} with no rate`,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    const left = totals.length - lines.length;

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${title}*`,
          ...lines,
          ...(left ? [`_and ${left} more_`] : []),
        ].join('\n'),
      },
    };
  }
}
