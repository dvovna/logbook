import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { REMINDED_BLOCK_ID } from '@modules/slack/receipts/views/reminders-modal.view';

const remindersSchema = z.object({
  reminded: z.array(z.object({ value: z.string(), text: z.string() })),
});

export interface IRemindersFormData {
  // Nothing checked is an empty list.
  reminded: { value: string; text: string }[];
}

@Injectable()
export class RemindersFormParser extends BaseValuesParser<IRemindersFormData> {
  public constructor() {
    super(remindersSchema, {
      reminded: { blockId: REMINDED_BLOCK_ID, type: ViewFieldType.Checkboxes },
    });
  }
}
