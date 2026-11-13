import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import {
  REMINDED_BLOCK_ID,
  TIME_REMINDER_BLOCK_ID,
} from '@modules/slack/receipts/views/reminders-modal.view';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';

const remindersSchema = z.object({
  timeReminder: z.object(
    { value: z.enum(TimeReminder), text: z.string() },
    { error: 'Choose how often.' },
  ),
  reminded: z
    .array(z.object({ value: z.string(), text: z.string() }))
    .default([]),
});

export interface IRemindersFormData {
  timeReminder: { value: TimeReminder; text: string };
  // Nothing checked, or a form without the receipts part, is an empty list.
  reminded: { value: string; text: string }[];
}

@Injectable()
export class RemindersFormParser extends BaseValuesParser<IRemindersFormData> {
  public constructor() {
    super(remindersSchema, {
      timeReminder: {
        blockId: TIME_REMINDER_BLOCK_ID,
        type: ViewFieldType.Select,
      },
      reminded: { blockId: REMINDED_BLOCK_ID, type: ViewFieldType.Checkboxes },
    });
  }
}
