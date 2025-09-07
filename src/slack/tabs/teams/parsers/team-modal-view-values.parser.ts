import { z } from 'zod';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from 'src/slack/common/utils/view-utils';

export const MAX_DESCRIPTION_LENGTH = 200;

const teamFormSchema = z.object({
  name: z.string().min(1, 'Team name is required'),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, 'Description must be at most 200 characters')
    .optional(),
  policy: z
    .object({
      value: z.string().min(1, 'Policy is required'),
      text: z.string().optional(),
    })
    .required(),
});

export interface ITeamFormViewData {
  name: string;
  policy: ISelectedOption;
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
      policy: {
        blockId: 'policy_block',
        type: ViewFieldType.Select,
      },
    });
  }
}
