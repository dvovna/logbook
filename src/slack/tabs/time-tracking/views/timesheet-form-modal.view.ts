import { Injectable } from '@nestjs/common';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { getDisplayTime } from '@common/utils/time.utils';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { timesheetCellLockLabel } from '@modules/slack/common/views/data/labels';
import { versionedBlockId } from '@modules/slack/services/slack-view-values.parser';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import {
  dayHeading,
  SATURDAY,
  weekLabel,
} from '@modules/slack/tabs/time-tracking/views/timesheet-table.view';
import { IUserProject } from 'src/projects/queries/get-user-projects.query';
import {
  cellKey,
  ITimesheetCell,
  ITimesheetRow,
  ITimesheetWeek,
  MAX_TIMESHEET_ROWS,
} from 'src/time-entries/types/timesheet.types';

// The section that starts a project's row: `${TIMESHEET_ROW_BLOCK_ID}:<project id>`.
export const TIMESHEET_ROW_BLOCK_ID = 'timesheet_row';
export const SUBMIT_WEEK_BLOCK_ID = 'timesheet_submit_week_too';
export const SUBMIT_WEEK_OPTION = 'submit';
const ADD_PROJECT_BLOCK_ID = 'timesheet_add_project';
const SHOW_WEEKEND_BLOCK_ID = 'timesheet_show_weekend';
const SHOW_WEEKEND_OPTION = 'show';
// What Slack takes in a static select.
const MAX_SELECT_OPTIONS = 100;

// Kept in the modal between its updates (rows added, the weekend shown) and
// until it is saved. The cells' values stay out: 70 of them don't fit into
// the 3000 characters of private_metadata, so what the form showed is read
// from its blocks.
export type TimesheetFormMetadata = {
  mode: 'week' | 'day';
  // The Monday of the form's week.
  weekStart: string;
  date?: string;
  // Rows added with "Add a project".
  addedProjectIds: string[];
  showWeekend: boolean;
  // My time's metadata, to show it again after saving.
  pageMetadata?: string;
};

interface ITimesheetFormViewParams extends IBaseModalViewParams<ViewCallbackId.TimesheetForm> {
  week: ITimesheetWeek;
  // The projects the user may log time on, for "Add a project".
  projects: IUserProject[];
}

const plainOption = (text: string, value: string): PlainTextOption => ({
  text: { type: 'plain_text', text },
  value,
});

// Fill in the week: an input for every day of every row project, hours in
// each, saved at once. A cell that can't be changed here (several entries,
// submitted, approved, billed, or a project closed for logging) shows as
// text.
@Injectable()
export class TimesheetFormModalView extends BaseModalView<
  ITimesheetFormViewParams,
  TimesheetFormMetadata
> {
  protected defaultCallbackId = ViewCallbackId.TimesheetForm;

  protected getTitleText(): string {
    return 'Fill in the week';
  }

  // "Save": entries go to the approvers only once they are submitted.
  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  protected getViewBlocks(
    { week, projects, errorMessage }: ITimesheetFormViewParams,
    { addedProjectIds, showWeekend }: TimesheetFormMetadata,
  ): AnyBlock[] {
    // Saturday and Sunday when asked for, or when they hold time.
    const shownDays = [...week.days.keys()].filter(
      (index) => index < SATURDAY || showWeekend || week.dayTotals[index] > 0,
    );
    const rowIds = new Set(week.rows.map((row) => row.projectId));
    const addable = projects.filter((project) => !rowIds.has(project.id));

    return [
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'plain_text',
            text: `Week of ${weekLabel(week.weekStart)} · hours a day, e.g. 1.5 · empty or 0 for no time`,
          },
        ],
      },
      ...(week.rows.length
        ? week.rows.flatMap((row) => this.getRowBlocks(row, shownDays))
        : [this.getNoRowsBlock(addable.length > 0)]),
      ...(week.rows.length < MAX_TIMESHEET_ROWS && addable.length
        ? [this.getAddProjectBlock(addable, addedProjectIds.length)]
        : []),
      this.getShowWeekendBlock(showWeekend),
      {
        type: 'input',
        block_id: SUBMIT_WEEK_BLOCK_ID,
        optional: true,
        label: { type: 'plain_text', text: 'Approval' },
        element: {
          type: 'checkboxes',
          action_id: TimesheetFormActionId.SubmitWeek,
          options: [
            plainOption(
              "Submit the week's time for approval",
              SUBMIT_WEEK_OPTION,
            ),
          ],
        },
      },
    ];
  }

  private getRowBlocks(row: ITimesheetRow, shownDays: number[]): AnyBlock[] {
    const cells = shownDays
      .map((index) => row.cells[index])
      // A day of a closed project without time has nothing to show.
      .filter((cell) => !cell.lock || cell.minutes > 0)
      .map((cell) =>
        cell.lock
          ? this.getLockedCellBlock(cell)
          : this.getCellBlock(row.projectId, cell),
      );

    return [
      {
        type: 'section',
        block_id: `${TIMESHEET_ROW_BLOCK_ID}:${row.projectId}`,
        text: {
          type: 'mrkdwn',
          // Names people typed.
          text: [
            `*${escapeMrkdwn(row.projectName)}*`,
            ...(row.clientName ? [escapeMrkdwn(row.clientName)] : []),
          ].join(' · '),
        },
      },
      ...(cells.length
        ? cells
        : [
            this.getContextBlock(
              `No time this week · ${timesheetCellLockLabel('project', 0)}`,
            ),
          ]),
    ];
  }

  // The hours of a cell: its block_id and action_id are its cellKey.
  private getCellBlock(projectId: string, cell: ITimesheetCell): AnyBlock {
    const key = cellKey(projectId, cell.date);

    return {
      type: 'input',
      block_id: key,
      optional: true,
      label: { type: 'plain_text', text: dayHeading(cell.date) },
      element: {
        type: 'plain_text_input',
        action_id: key,
        ...(cell.minutes ? { initial_value: String(cell.minutes / 60) } : {}),
      },
    };
  }

  // 'Wed 17 · 2h · submitted'
  private getLockedCellBlock(cell: ITimesheetCell): AnyBlock {
    return this.getContextBlock(
      [
        dayHeading(cell.date),
        getDisplayTime(cell.minutes),
        timesheetCellLockLabel(cell.lock!, cell.entryCount),
      ].join(' · '),
    );
  }

  private getContextBlock(text: string): AnyBlock {
    return { type: 'context', elements: [{ type: 'plain_text', text }] };
  }

  private getNoRowsBlock(canAdd: boolean): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: canAdd
          ? 'No time in the last weeks: add a project to log time on it.'
          : 'You have no projects to log time on yet. Ask an admin to add you or your team to a project.',
      },
    };
  }

  // A new block_id after every added row: views.update keeps what a field
  // with the same block_id holds, and the select starts empty again.
  private getAddProjectBlock(
    projects: IUserProject[],
    added: number,
  ): AnyBlock {
    return {
      type: 'input',
      block_id: versionedBlockId(ADD_PROJECT_BLOCK_ID, String(added)),
      dispatch_action: true,
      optional: true,
      label: { type: 'plain_text', text: 'Add a project' },
      element: {
        type: 'static_select',
        action_id: TimesheetFormActionId.AddProject,
        placeholder: { type: 'plain_text', text: 'Choose a project' },
        options: projects.slice(0, MAX_SELECT_OPTIONS).map((project) =>
          toPlainTextOption({
            id: project.id,
            name: project.name,
            description: project.clientName,
          }),
        ),
      },
    };
  }

  private getShowWeekendBlock(showWeekend: boolean): AnyBlock {
    const option = plainOption('Show Saturday and Sunday', SHOW_WEEKEND_OPTION);

    return {
      type: 'input',
      block_id: SHOW_WEEKEND_BLOCK_ID,
      dispatch_action: true,
      optional: true,
      label: { type: 'plain_text', text: 'Weekend' },
      element: {
        type: 'checkboxes',
        action_id: TimesheetFormActionId.ShowWeekend,
        options: [option],
        ...(showWeekend ? { initial_options: [option] } : {}),
      },
    };
  }
}
