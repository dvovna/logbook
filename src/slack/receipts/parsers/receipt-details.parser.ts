import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { MAX_RECEIPT_AMOUNT_CENTS } from 'src/receipts/constants/receipt-limits';

export const MAX_RECEIPT_COMMENT_LENGTH = 300;

// "45,50", "45.5", "1 000,00": spaces between thousands, a comma or a point
// before at most two decimals. Cents, or null for anything else, zero and
// over the limit included.
export const parseAmount = (text: string): number | null => {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(
    text.trim().replace(/\s/g, ''),
  );

  if (!match) {
    return null;
  }

  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));

  return cents >= 1 && cents <= MAX_RECEIPT_AMOUNT_CENTS ? cents : null;
};

const selected = (message: string) =>
  z.object({ value: z.string(), text: z.string() }, { error: message });

const receiptDetailsSchema = z.object({
  reimbursement: selected('Choose a reimbursement.'),
  month: selected('Choose a month.'),
  amount: z
    .string()
    .refine(
      (text) => parseAmount(text) !== null,
      'Enter an amount above zero, like 45.50.',
    )
    .transform((text) => parseAmount(text) as number),
  comment: z
    .string()
    .max(
      MAX_RECEIPT_COMMENT_LENGTH,
      `The comment must be at most ${MAX_RECEIPT_COMMENT_LENGTH} characters`,
    )
    .optional(),
});

export interface IReceiptDetailsFormData {
  reimbursement: ISelectedOption;
  month: ISelectedOption;
  // In cents.
  amount: number;
  comment?: string;
}

@Injectable()
export class ReceiptDetailsParser extends BaseValuesParser<IReceiptDetailsFormData> {
  public constructor() {
    super(receiptDetailsSchema, {
      reimbursement: {
        blockId: 'reimbursement_block',
        type: ViewFieldType.Select,
      },
      month: { blockId: 'month_block', type: ViewFieldType.Select },
      amount: { blockId: 'amount_block', type: ViewFieldType.Text },
      comment: { blockId: 'comment_block', type: ViewFieldType.Text },
    });
  }
}
