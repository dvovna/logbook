import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { parseAmount } from '@modules/slack/receipts/parsers/receipt-details.parser';

export const MAX_REIMBURSEMENT_NAME_LENGTH = 50;

const reimbursementSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .max(
      MAX_REIMBURSEMENT_NAME_LENGTH,
      `The name must be at most ${MAX_REIMBURSEMENT_NAME_LENGTH} characters`,
    ),
  dueDay: z.coerce
    .number()
    .int('The due day is from 1 to 28.')
    .min(1, 'The due day is from 1 to 28.')
    .max(28, 'The due day is from 1 to 28.'),
  limit: z
    .string()
    .refine(
      (text) => !text.trim() || parseAmount(text) !== null,
      'Enter an amount above zero, like 50.00.',
    )
    .transform((text) => (text.trim() ? (parseAmount(text) as number) : null)),
});

export interface IReimbursementFormData {
  name: string;
  dueDay: number;
  // In cents; null for no limit.
  limit: number | null;
}

// The fields are read by their config key, which the form's inputs use as
// their action_id (and the domain errors as their field).
@Injectable()
export class ReimbursementModalParser extends BaseValuesParser<IReimbursementFormData> {
  public constructor() {
    super(reimbursementSchema, {
      name: { blockId: 'name_block', type: ViewFieldType.Text },
      dueDay: { blockId: 'due_day_block', type: ViewFieldType.Text },
      limit: { blockId: 'limit_block', type: ViewFieldType.Text },
    });
  }
}
