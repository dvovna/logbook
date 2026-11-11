import type { InputBlock } from '@slack/web-api';
import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  getSelectedOptions,
  getValue,
} from '@modules/slack/common/utils/parsing-utils';
import { IViewParseResult } from '@modules/slack/services/slack-view-values.parser';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { hoursSchema } from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import {
  COMMENT_BLOCK_ID,
  SUBMIT_WEEK_BLOCK_ID,
} from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { MAX_TIME_ENTRY_DESCRIPTION_LENGTH } from '@common/constants/text-limits';
import { parseCellKey } from '@modules/slack/tabs/time-tracking/utils/timesheet-cell-key';
import { ITimesheetCellChange } from 'src/time-entries/types/timesheet.types';

export interface ITimesheetFormData {
  // Every cell the form sent, typed into or not.
  cells: ITimesheetCellChange[];
  submitWeek: boolean;
  // The day form's comment; undefined when empty or not in the form.
  comment?: string;
}

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
  const cells: ITimesheetCellChange[] = [];
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
      expectedMinutes: 'error' in before ? null : before.minutes,
    });
  }

  const comment = getValue(
    values,
    COMMENT_BLOCK_ID,
    TimesheetFormActionId.Comment,
  ).trim();

  if (comment.length > MAX_TIME_ENTRY_DESCRIPTION_LENGTH) {
    errors[COMMENT_BLOCK_ID] =
      `Comment must be at most ${MAX_TIME_ENTRY_DESCRIPTION_LENGTH} characters`;
  }

  if (Object.keys(errors).length) {
    return { errors };
  }

  return {
    data: {
      cells,
      comment: comment || undefined,
      submitWeek:
        getSelectedOptions(
          values,
          SUBMIT_WEEK_BLOCK_ID,
          TimesheetFormActionId.SubmitWeek,
        ).length > 0,
    },
  };
};
