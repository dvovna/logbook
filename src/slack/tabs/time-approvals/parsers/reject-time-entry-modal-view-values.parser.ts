import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';

export const MAX_REJECTION_REASON_LENGTH = 300;

const rejectTimeEntrySchema = z.object({
  reason: z
    .string()
    .max(
      MAX_REJECTION_REASON_LENGTH,
      `Reason must be at most ${MAX_REJECTION_REASON_LENGTH} characters`,
    )
    .optional(),
});

export interface IRejectTimeEntryFormViewData {
  reason?: string;
}

@Injectable()
export default class RejectTimeEntryModalViewValuesParser extends BaseValuesParser<IRejectTimeEntryFormViewData> {
  public constructor() {
    super(rejectTimeEntrySchema, {
      reason: { blockId: 'reason_block', type: ViewFieldType.Text },
    });
  }
}
