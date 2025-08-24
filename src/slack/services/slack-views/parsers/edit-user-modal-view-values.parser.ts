import { z } from 'zod';
import BaseValuesParser from 'src/slack/services/slack-views/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';

export const editUserFormSchema = z.object({
  role: z.enum(Object.values(UserRole), {
    message: 'Invalid user role',
  }),
  team_id: z.string().min(1, 'Team is required'),
  carryover_days: z.coerce
    .number()
    .min(0, 'Carryover days cannot be negative')
    .max(30, 'Carryover days cannot exceed 30')
    .default(0),
});

export interface IEditUserFormViewData {
  role: UserRole;
  team_id: string;
  carryover_days: number;
}

@Injectable()
export default class EditUserModalViewValuesParser extends BaseValuesParser<IEditUserFormViewData> {
  public constructor() {
    super(editUserFormSchema, {
      role: {
        blockId: 'role_block',
        type: ViewFieldType.Select,
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
