import { z } from 'zod';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import { ISelectedOption } from 'src/slack/common/utils/parsing-utils';

export const editUserFormSchema = z.object({
  role: z.object({
    value: z.enum(Object.values(UserRole), {
      message: 'Invalid user role',
    }),
    text: z.string(),
  }),
  team_id: z.object({
    value: z.string().min(1, 'Team is required'),
    text: z.string(),
  }),
  contract_start_date: z.string().nullable(),
  carryover_days: z.coerce
    .number()
    .min(0, 'Carryover days cannot be negative')
    .max(30, 'Carryover days cannot exceed 30')
    .default(0),
});

export interface IEditUserFormData {
  role: ISelectedOption<UserRole>;
  team_id: ISelectedOption;
  contract_start_date?: string | null;
  carryover_days: number;
}

@Injectable()
export default class EditUserModalViewValuesParser extends BaseValuesParser<IEditUserFormData> {
  public constructor() {
    super(editUserFormSchema, {
      role: {
        blockId: 'role_block',
        type: ViewFieldType.Select,
      },
      contract_start_date: {
        blockId: 'contract_start_date_block',
        type: ViewFieldType.Date,
      },
      team_id: {
        blockId: 'team_block',
        type: ViewFieldType.Select,
      },
      carryover_days: {
        blockId: 'carryover_days_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
