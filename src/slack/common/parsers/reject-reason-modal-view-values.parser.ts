import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { MAX_REJECTION_REASON_LENGTH } from '@common/constants/text-limits';

const rejectReasonSchema = z.object({
  reason: z
    .string()
    .max(
      MAX_REJECTION_REASON_LENGTH,
      `Reason must be at most ${MAX_REJECTION_REASON_LENGTH} characters`,
    )
    .optional(),
});

export interface IRejectReasonFormViewData {
  reason?: string;
}

// The Reject form of time entries and vacation requests.
@Injectable()
export default class RejectReasonModalViewValuesParser extends BaseValuesParser<IRejectReasonFormViewData> {
  public constructor() {
    super(rejectReasonSchema, {
      reason: { blockId: 'reason_block', type: ViewFieldType.Text },
    });
  }
}
