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
import {
  IAppliedFilters,
  IMissingTimeReport,
  ITimeReport,
  ITimeReportFilters,
  ITimeReportRow,
  TimeReportGrouping,
} from 'src/time-entries/services/time-report.service';
import { TimeScopeKind } from 'src/time-entries/services/time-entries-scope.service';
import { formatHourlyRate, formatMoney } from '@common/utils/money.utils';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { Divider } from '@modules/slack/common/views/components/separator';
import {
  canOpenScreen,
  ScreenId,
  SCREENS,
} from '@modules/slack/common/navigation/screens';
import {
  fitTableRows,
  moreLinesBlocks,
  tableBlock,
} from '@modules/slack/tabs/reports/views/report-table';
import { formatDate } from '@common/utils/date.utils';
import {
  IUninvoicedPeriod,
  IUninvoicedReport,
} from 'src/billing/services/uninvoiced-report.service';

export interface IReportsTabMetadata {
  // The billing report on show, from its form.
  report?: { clientId: string; fromDate: string; toDate: string };
  // The time report on show, with its filters, from its form; one report
  // shows at a time.
  timeReport?: {
    kind: TimeReportKind;
    fromDate: string;
    toDate: string;
  } & ITimeReportFilters;
  // The uninvoiced report on show, from its form: no date is no limit.
  uninvoiced?: IUninvoicedPeriod;
}

interface IGetViewParams extends IBaseTabViewParams {
  weekSummary: IWorkspaceTimeSummary;
  billingReport: IBillingReport | null;
  timeReport: ITimeReport | null;
  missingTime: IMissingTimeReport | null;
  uninvoiced: IUninvoicedReport | null;
}

// Lines of a "By project" or "By person" list.
const MAX_TOTALS = 40;

const NONE = '–';

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

const GROUP_TITLES: Record<TimeReportGrouping, string> = {
  [TimeReportGrouping.Client]: 'Client',
  [TimeReportGrouping.Project]: 'Project',
  [TimeReportGrouping.Person]: 'Person',
  [TimeReportGrouping.Team]: 'Team',
};

// Whose time a report counts.
const SCOPE_NOTES: Record<TimeScopeKind, string> = {
  workspace: "Everyone's time",
  teams: "Your teams' time and yours",
  own: 'Your time',
};

// "Client: Acme", "Project: Website", "Person: Mia": what a report was
// narrowed to.
const filterNotes = ({ client, project, person }: IAppliedFilters) =>
  [
    client && `Client: ${escapeMrkdwn(client)}`,
    project && `Project: ${escapeMrkdwn(project)}`,
    person && `Person: ${escapeMrkdwn(person)}`,
  ].filter((note): note is string => !!note);

// "All time", "1–30 Jun 2026", "Since 1 Jun 2026", "Up to 30 Jun 2026".
const openPeriodText = ({ fromDate, toDate }: IUninvoicedPeriod) =>
  fromDate && toDate
    ? formatDateRange(fromDate, toDate)
    : fromDate
      ? `Since ${formatDate(fromDate)}`
      : toDate
        ? `Up to ${formatDate(toDate)}`
        : 'All time';

const context = (text: string): AnyBlock => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text }],
});

// The week at a glance and the time report, for everyone in their scope
// (TimeEntriesScopeService); for Admin and HR also the billing report (and
// locking its time in a snapshot), the uninvoiced report, billing snapshots
// and everyone's time logs.
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
    timeReport,
    missingTime,
    uninvoiced,
    userRole,
  }: IGetViewParams): AnyBlock[] {
    const week: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*This week*',
          [
            `*${hours(weekSummary.weekMinutes)}* logged`,
            `*${hours(weekSummary.weekBillableMinutes)}* billable`,
            // Projects are for those who manage them.
            canOpenScreen(ScreenId.Projects, userRole) &&
              `*${weekSummary.activeProjects}* active projects`,
          ]
            .filter(Boolean)
            .join(' · '),
        ].join('\n'),
      },
    };
    const forAdmins = canOpenScreen(ScreenId.TimeLogs, userRole);

    return [
      week,
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📈 Time report' },
            style: 'primary',
            action_id: ReportsTabActionId.TimeReport,
          },
          ...(forAdmins
            ? [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '📊 Billing report' },
                  action_id: ReportsTabActionId.BillingReport,
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '🧾 Uninvoiced' },
                  action_id: ReportsTabActionId.Uninvoiced,
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: SCREENS[ScreenId.BillingSnapshots].title,
                  },
                  action_id: NavigationActionId.BillingSnapshots,
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '⏱ Time logs' },
                  action_id: NavigationActionId.TimeLogs,
                },
              ]
            : []),
        ],
      } as AnyBlock,
      ...(timeReport ? this.getTimeReportBlocks(timeReport) : []),
      ...(missingTime ? this.getMissingTimeBlocks(missingTime) : []),
      ...(billingReport ? this.getBillingReportBlocks(billingReport) : []),
      ...(uninvoiced ? this.getUninvoicedBlocks(uninvoiced) : []),
    ];
  }

  // Everything logged in the period by client, project, person or team: a
  // table with the total, and the button that sends the entries as CSV.
  private getTimeReportBlocks(report: ITimeReport): AnyBlock[] {
    const withAmounts = report.currency !== null;
    const money = (cents: number | null) =>
      cents === null ? NONE : formatMoney(cents, report.currency!);
    const { total } = report;
    const summary: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          [
            `*Time by ${GROUP_TITLES[report.groupBy].toLowerCase()}*`,
            formatDateRange(report.fromDate, report.toDate),
            SCOPE_NOTES[report.scope],
            ...filterNotes(report.filters),
          ].join(' · '),
          [
            `Logged *${hours(total.minutes)}*`,
            `billable *${hours(total.billableMinutes)}*`,
            `approved *${hours(total.approvedMinutes)}*`,
            withAmounts && `amount *${money(total.amount)}*`,
          ]
            .filter(Boolean)
            .join(' · '),
          report.unratedMinutes &&
            `_No rate: ${hours(report.unratedMinutes)} of billable time, not in the amounts_`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    };

    if (!total.minutes) {
      return [
        ...Divider.getBlocks(),
        summary,
        context('_No time logged in this period._'),
      ];
    }

    const toRow = (row: ITimeReportRow) => [
      row.name,
      hours(row.minutes),
      hours(row.billableMinutes),
      hours(row.approvedMinutes),
      ...(withAmounts ? [money(row.amount)] : []),
    ];
    const { rows, left } = fitTableRows(
      [
        GROUP_TITLES[report.groupBy],
        'Hours',
        'Billable',
        'Approved',
        ...(withAmounts ? ['Amount'] : []),
      ],
      report.rows.map(toRow),
      [toRow(total)],
    );

    return [
      ...Divider.getBlocks(),
      summary,
      tableBlock(rows, [
        'left',
        'right',
        'right',
        'right',
        ...(withAmounts ? (['right'] as const) : []),
      ]),
      ...moreLinesBlocks(left, ', in the total'),
      ...(withAmounts
        ? [
            context(
              "_Amounts are of all billable time in the report, at today's rates; the billing report counts approved time only._",
            ),
          ]
        : []),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📥 Send CSV to my DMs' },
            action_id: ReportsTabActionId.ExportTimeReport,
          },
        ],
      } as AnyBlock,
    ];
  }

  // The people who logged nothing in the period, or have drafts or rejected
  // entries in it.
  private getMissingTimeBlocks(report: IMissingTimeReport): AnyBlock[] {
    const { lines, peopleCount } = report;
    const summary: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Who hasn't submitted* · ${formatDateRange(report.fromDate, report.toDate)} · ${SCOPE_NOTES[report.scope]}`,
          lines.length
            ? `*${lines.length}* of *${peopleCount}* ${peopleCount === 1 ? 'person' : 'people'} logged nothing, or have drafts or rejected time not sent for approval.`
            : `Everyone (*${peopleCount}*) has sent their time of this period for approval.`,
        ].join('\n'),
      },
    };

    if (!lines.length) {
      return [...Divider.getBlocks(), summary];
    }

    const { rows, left } = fitTableRows(
      ['Person', 'Team', 'Logged', 'Not submitted'],
      lines.map((line) => [
        line.name,
        line.teamName ?? NONE,
        hours(line.loggedMinutes),
        line.unsubmittedCount
          ? `${hours(line.unsubmittedMinutes)} (${line.unsubmittedCount} ${line.unsubmittedCount === 1 ? 'entry' : 'entries'})`
          : NONE,
      ]),
    );

    return [
      ...Divider.getBlocks(),
      summary,
      tableBlock(rows, ['left', 'left', 'right', 'right']),
      ...moreLinesBlocks(left),
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
          report.snapshotMinutes &&
            `_In billing snapshots already: ${hours(report.snapshotMinutes)} of the approved time_`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    };

    if (!report.approvedMinutes) {
      return [
        ...Divider.getBlocks(),
        summary,
        context('_No approved time for this client in this period._'),
      ];
    }

    const { rows, left } = fitTableRows(
      ['Project', 'Person', 'Hours', 'Billable', 'Rate', 'Amount'],
      report.lines.map((line) => [
        line.projectName,
        line.personName,
        hours(line.minutes),
        hours(line.billableMinutes),
        line.hourlyRate === null
          ? NONE
          : formatHourlyRate(line.hourlyRate, report.currency),
        line.amount === null ? NONE : money(line.amount),
      ]),
      [
        [
          'Total',
          NONE,
          hours(report.approvedMinutes),
          hours(report.billableMinutes),
          NONE,
          money(report.amount),
        ],
      ],
    );

    return [
      ...Divider.getBlocks(),
      summary,
      tableBlock(rows, ['left', 'left', 'right', 'right', 'right', 'right']),
      ...moreLinesBlocks(left, ', in the total'),
      this.getTotalsBlock('By project', report.byProject, money),
      this.getTotalsBlock('By person', report.byPerson, money),
      ...(report.approvedMinutes > report.snapshotMinutes
        ? this.getLockBlocks()
        : []),
    ];
  }

  // Locks the approved time of the report that isn't in a snapshot yet.
  private getLockBlocks(): AnyBlock[] {
    return [
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔒 Lock in a snapshot' },
            action_id: ReportsTabActionId.LockSnapshot,
          },
        ],
      } as AnyBlock,
      context(
        "_A snapshot keeps this approved time with today's rates for an invoice: nobody can change it until an admin unlocks the snapshot._",
      ),
    ];
  }

  // Per client, what hasn't been invoiced: approved billable time in no
  // snapshot (at today's rates), and the time of snapshots not marked
  // invoiced (at their rates).
  private getUninvoicedBlocks(report: IUninvoicedReport): AnyBlock[] {
    const money = (cents: number) => formatMoney(cents, report.currency);
    const { total } = report;
    const summary: AnyBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Uninvoiced time* · ${openPeriodText(report)} · Approved billable time that isn't invoiced yet`,
          `Not in a snapshot: *${hours(total.minutes)}*, *${money(total.amountCents)}* at today's rates`,
          `In snapshots not marked invoiced: *${hours(total.snapshotMinutes)}*, *${money(total.snapshotAmountCents)}*`,
          total.unratedMinutes &&
            `_No rate: ${hours(total.unratedMinutes)} of billable time, not in the amounts_`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    };

    if (!report.rows.length) {
      return [
        ...Divider.getBlocks(),
        summary,
        context(
          '_Nothing to invoice: all approved billable time of the period is invoiced._',
        ),
      ];
    }

    const { rows, left } = fitTableRows(
      [
        'Client',
        'Not in a snapshot',
        'Amount',
        'Since',
        'In snapshots',
        'Snapshot amount',
      ],
      report.rows.map((row) => [
        row.clientName,
        hours(row.minutes),
        money(row.amountCents),
        row.since ? formatDate(row.since) : NONE,
        hours(row.snapshotMinutes),
        money(row.snapshotAmountCents),
      ]),
      [
        [
          'Total',
          hours(total.minutes),
          money(total.amountCents),
          NONE,
          hours(total.snapshotMinutes),
          money(total.snapshotAmountCents),
        ],
      ],
    );

    return [
      ...Divider.getBlocks(),
      summary,
      tableBlock(rows, ['left', 'right', 'right', 'right', 'right', 'right']),
      ...moreLinesBlocks(left, ', in the total'),
      context(
        '_Since: the earliest day of the time not in a snapshot. In snapshots: the snapshots not marked invoiced yet, at the rates they keep; mark them in Billing snapshots._',
      ),
    ];
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
