import { AnyBlock } from '@slack/web-api';
import pluralize from 'pluralize';
import { getDisplayTime } from '@common/utils/time.utils';
import { formatDayMonth, weekdayOf, weekLabel } from '@common/utils/date.utils';
import {
  fitTableRows,
  moreLinesBlocks,
  tableBlock,
} from '@modules/slack/tabs/reports/views/report-table';
import { TIME_ENTRY_STATUS_LABELS } from '@modules/slack/common/views/data/labels';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimesheetWeek } from 'src/time-entries/types/timesheet.types';

// The index of Saturday in a week's days (Monday first).
export const SATURDAY = 5;

export const dayHeading = (date: string) =>
  `${weekdayOf(date)} ${Number(date.slice(8))}`;

export const dayLabel = (date: string) =>
  `${weekdayOf(date)} ${formatDayMonth(date)}`;

// '–' for no time: it reads better than 0m, and Slack refuses an empty cell.
const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '–');

export class TimesheetTableView {
  // Saturday and Sunday show only when they hold time.
  public static getBlocks(week: ITimesheetWeek): AnyBlock[] {
    return [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: this.getStatusLine(week) }],
      },
      ...this.getTableBlocks(week),
    ];
  }

  private static getStatusLine(week: ITimesheetWeek): string {
    const statuses = Object.values(TimeEntryStatus)
      .filter((status) => week.statusCounts[status] > 0)
      .map((status) => {
        const label = TIME_ENTRY_STATUS_LABELS[status];
        const count = week.statusCounts[status];

        return `${label.icon} ${count} ${
          status === TimeEntryStatus.Draft
            ? pluralize('draft', count)
            : label.label.toLowerCase()
        }`;
      });

    return [
      `🕒 Week of ${weekLabel(week.weekStart)}`,
      week.total ? getDisplayTime(week.total) : 'nothing logged',
      ...statuses,
    ].join(' · ');
  }

  private static getTableBlocks(week: ITimesheetWeek): AnyBlock[] {
    if (!week.rows.length) {
      return [];
    }

    const shown = [...week.days.keys()].filter(
      (index) => index < SATURDAY || week.dayTotals[index] > 0,
    );
    const header = [
      'Project',
      ...shown.map((index) => dayHeading(week.days[index])),
      'Total',
    ];
    const rows = week.rows.map((row) => [
      row.clientName
        ? `${row.projectName} · ${row.clientName}`
        : row.projectName,
      ...shown.map((index) => hours(row.cells[index].minutes)),
      hours(row.cells.reduce((sum, cell) => sum + cell.minutes, 0)),
    ]);
    const totals = [
      'Total',
      ...shown.map((index) => hours(week.dayTotals[index])),
      hours(week.total),
    ];
    // Every project of the week; past what a table holds, the rest only in
    // the totals.
    const fitted = fitTableRows(header, rows, [totals]);

    return [
      tableBlock(fitted.rows, [
        'left',
        ...header.slice(1).map((): 'right' => 'right'),
      ]),
      ...moreLinesBlocks(fitted.left, ', in the total'),
    ];
  }
}
