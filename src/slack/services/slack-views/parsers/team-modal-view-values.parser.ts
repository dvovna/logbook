import { z } from 'zod';
import BaseValuesParser from 'src/slack/services/slack-views/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';

export const MAX_DESCRIPTION_LENGTH = 200;

const teamFormSchema = z.object({
  name: z.string().min(1, 'Team name is required'),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, 'Description must be at most 200 characters')
    .optional(),
  policy_id: z.string(),
});

export interface ITeamFormViewData {
  name: string;
  policy_id: string;
  description?: string;
}

@Injectable()
export default class TeamModalViewValuesParser extends BaseValuesParser<ITeamFormViewData> {
  public constructor() {
    super(teamFormSchema, {
      name: {
        blockId: 'name_block',
        type: ViewFieldType.Text,
      },
      description: {
        blockId: 'description_block',
        type: ViewFieldType.Text,
      },
      policy_id: {
        blockId: 'policy_block',
        type: ViewFieldType.Select,
      },
    });
  }
}
