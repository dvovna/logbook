import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { MAX_RECEIPT_REJECTION_REASON_LENGTH } from 'src/receipts/constants/receipt-limits';

const rejectReceiptSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Give a reason.')
    .max(
      MAX_RECEIPT_REJECTION_REASON_LENGTH,
      `The reason must be at most ${MAX_RECEIPT_REJECTION_REASON_LENGTH} characters`,
    ),
});

export interface IRejectReceiptFormData {
  reason: string;
}

@Injectable()
export class RejectReceiptParser extends BaseValuesParser<IRejectReceiptFormData> {
  public constructor() {
    super(rejectReceiptSchema, {
      reason: { blockId: 'reason_block', type: ViewFieldType.Text },
    });
  }
}
