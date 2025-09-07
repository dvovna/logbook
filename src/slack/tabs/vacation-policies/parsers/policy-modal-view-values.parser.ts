import { z } from 'zod';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';

export const MAX_POLICY_NAME_LENGTH = 100;

const policyFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Policy name is required')
    .max(MAX_POLICY_NAME_LENGTH, 'Policy name must be at most 100 characters'),
  vacation_days: z.coerce
    .number()
    .min(0, 'Calendar days cannot be negative')
    .max(30, 'Calendar days cannot exceed 30')
    .default(0),
  working_days: z.coerce
    .number()
    .min(0, 'Working days cannot be negative')
    .max(30, 'Working days cannot exceed 30')
    .default(0),
  carryover_days: z.coerce
    .number()
    .min(0, 'Carryover days cannot be negative')
    .max(30, 'Carryover days cannot exceed 30')
    .default(0),
  bonus_days: z.coerce
    .number()
    .min(0, 'Bonus days cannot be negative')
    .max(30, 'Bonus days cannot exceed 30')
    .default(0),
});

export interface IVacationPolicyFormData {
  name: string;
  vacation_days: number;
  working_days: number;
  carryover_days: number;
  bonus_days: number;
}

@Injectable()
export default class PolicyModalViewValuesParser extends BaseValuesParser<IVacationPolicyFormData> {
  public constructor() {
    super(policyFormSchema, {
      name: {
        blockId: 'name_block',
        type: ViewFieldType.Text,
      },
      vacation_days: {
        blockId: 'vacation_days_block',
        type: ViewFieldType.Text,
      },
      working_days: {
        blockId: 'working_days_block',
        type: ViewFieldType.Text,
      },
      bonus_days: {
        blockId: 'bonus_days_block',
        type: ViewFieldType.Text,
      },
      carryover_days: {
        blockId: 'carryover_days_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
