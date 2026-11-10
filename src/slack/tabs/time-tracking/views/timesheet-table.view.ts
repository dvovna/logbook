import { AnyBlock } from '@slack/web-api';
import pluralize from 'pluralize';
import { getDisplayTime } from '@common/utils/time.utils';
import { formatDate } from '@common/utils/date.utils';
import { tableBlock } from '@modules/slack/tabs/reports/views/report-table';
import { TIME_ENTRY_STATUS_LABELS } from '@modules/slack/common/views/data/labels';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimesheetWeek } from 'src/time-entries/types/timesheet.types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The index of Saturday in a week's days (Monday first).
export const SATURDAY = 5;

// 'Mon 15'
export const dayHeading = (date: string) =>
  `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}`;

// The week of Monday 15 June 2026: '15 Jun'.
export const weekLabel = (weekStart: string) =>
  formatDate(weekStart).replace(/ \d{4}$/, '');

// '' for no time: an empty cell reads better than 0m.
const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '');

export class TimesheetTableView {
  // The week's status line and its table of projects by day. Saturday and
  // Sunday show only when they hold time.
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

    return [
      tableBlock(
        [header, ...rows, totals],
        ['left', ...header.slice(1).map((): 'right' => 'right')],
      ),
    ];
  }
}
