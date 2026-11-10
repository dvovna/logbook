import type { InputBlock } from '@slack/web-api';
import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { getSelectedOptions } from '@modules/slack/common/utils/parsing-utils';
import { IViewParseResult } from '@modules/slack/services/slack-view-values.parser';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { hoursSchema } from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { SUBMIT_WEEK_BLOCK_ID } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { ITimesheetCellInput } from 'src/time-entries/types/timesheet.types';

export interface ITimesheetFormData {
  // Every cell the form sent, typed into or not.
  cells: ITimesheetCellInput[];
  // Submit the week's drafts and rejected entries after saving.
  submitWeek: boolean;
}

// cellKey(projectId, date): a project's UUID and a day.
const CELL_KEY =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d{4}-\d{2}-\d{2})$/i;

// The project and the day of a cell's key; null for the form's other fields.
export const parseCellKey = (
  key: string,
): { projectId: string; date: string } | null => {
  const match = CELL_KEY.exec(key);

  return match ? { projectId: match[1], date: match[2] } : null;
};

// A cell's hours as minutes. Empty or 0 is no time (null); anything else
// takes Log Time's rules and messages.
export const parseCellHours = (
  value: string | null | undefined,
): { minutes: number | null } | { error: string } => {
  const hours = (value ?? '').trim().replace(',', '.');

  if (!hours || Number(hours) === 0) {
    return { minutes: null };
  }

  const parsed = hoursSchema.safeParse(value);

  return parsed.success
    ? { minutes: Math.round(parsed.data * 60) }
    : { error: parsed.error.issues[0].message };
};

// What the form showed in each cell: its input's initial value.
const shownHours = (view: ISlackView) =>
  new Map(
    (view.blocks ?? [])
      .filter((block): block is InputBlock => block.type === 'input')
      .map((block) => [
        block.block_id,
        (block.element as { initial_value?: string }).initial_value,
      ]),
  );

// Reads the timesheet form: a cell for every state value under a cellKey,
// with what the form showed in it; errors at every cell that isn't hours.
export const parseTimesheetForm = (
  view: ISlackView,
): IViewParseResult<ITimesheetFormData> => {
  const values = view.state?.values ?? {};
  const shown = shownHours(view);
  const cells: ITimesheetCellInput[] = [];
  const errors: Record<string, string> = {};

  for (const [blockId, fields] of Object.entries(values)) {
    const cell = parseCellKey(blockId);
    const field = fields[blockId];

    if (!cell || !field) {
      continue;
    }

    const typed = parseCellHours(field.value);
    const before = parseCellHours(shown.get(blockId));

    if ('error' in typed) {
      errors[blockId] = typed.error;

      continue;
    }

    cells.push({
      ...cell,
      minutes: typed.minutes,
      shownMinutes: 'error' in before ? null : before.minutes,
    });
  }

  if (Object.keys(errors).length) {
    return { errors };
  }

  return {
    data: {
      cells,
      submitWeek:
        getSelectedOptions(
          values,
          SUBMIT_WEEK_BLOCK_ID,
          TimesheetFormActionId.SubmitWeek,
        ).length > 0,
    },
  };
};
