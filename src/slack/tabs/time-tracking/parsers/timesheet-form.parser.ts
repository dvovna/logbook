import { Injectable } from '@nestjs/common';
import type { InputBlock } from '@slack/web-api';
import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  getSelectedOptions,
  getValue,
} from '@modules/slack/common/utils/parsing-utils';
import {
  IFormParser,
  IViewParseResult,
} from '@modules/slack/common/types/form-parser.types';
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
  // What the form showed in its cells (shownMinutes), for the form it comes
  // back as after an error.
  shownMinutes: Map<string, number | null>;
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

const inputBlocks = (view: ISlackView) =>
  (view.blocks ?? []).filter(
    (block): block is InputBlock => block.type === 'input',
  );

// The cells differ from form to form: no fixed field config fits them.
@Injectable()
export class TimesheetFormParser implements IFormParser<ITimesheetFormData> {
  // A cell for every state value under a cellKey, with what the form showed
  // in it; errors at every cell that isn't hours.
  public parse(view: ISlackView): IViewParseResult<ITimesheetFormData> {
    const values = view.state?.values ?? {};
    const shown = this.shownMinutes(view);
    const cells: ITimesheetCellChange[] = [];
    const errors: Record<string, string> = {};

    for (const [blockId, fields] of Object.entries(values)) {
      const cell = parseCellKey(blockId);
      const field = fields[blockId];

      if (!cell || !field) {
        continue;
      }

      const typed = parseCellHours(field.value);

      if ('error' in typed) {
        errors[blockId] = typed.error;

        continue;
      }

      cells.push({
        ...cell,
        minutes: typed.minutes,
        expectedMinutes: shown.get(blockId) ?? null,
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
        shownMinutes: shown,
        comment: comment || undefined,
        submitWeek:
          getSelectedOptions(
            values,
            SUBMIT_WEEK_BLOCK_ID,
            TimesheetFormActionId.SubmitWeek,
          ).length > 0,
      },
    };
  }

  // What the form showed in each of its cell inputs, by cellKey: the
  // minutes of its initial value, null for none. A rebuild of the form shows
  // them again in the cells it keeps, so that a change made elsewhere since
  // the form opened is still refused at the cell.
  public shownMinutes(view: ISlackView): Map<string, number | null> {
    const shown = new Map<string, number | null>();

    for (const block of inputBlocks(view)) {
      if (!block.block_id || !parseCellKey(block.block_id)) {
        continue;
      }

      const hours = parseCellHours(
        (block.element as { initial_value?: string }).initial_value,
      );

      shown.set(block.block_id, 'error' in hours ? null : hours.minutes);
    }

    return shown;
  }

  // A cell's field is its cellKey. A cell the form has no input for came
  // from the client: its error shows in the modal.
  public blockIdOf(field: string, view: ISlackView): string | null {
    const blockId = field === 'comment' ? COMMENT_BLOCK_ID : field;

    return inputBlocks(view).some((block) => block.block_id === blockId)
      ? blockId
      : null;
  }
}
