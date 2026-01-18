import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_PROJECT_NAME_LENGTH = 50;

const projectFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters`,
    ),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, 'Description must be at most 200 characters')
    .optional(),
});

export interface IProjectFormViewData {
  name: string;
  description?: string;
}

@Injectable()
export default class ProjectModalViewValuesParser extends BaseValuesParser<IProjectFormViewData> {
  public constructor() {
    super(projectFormSchema, {
      name: {
        blockId: 'name_block',
        type: ViewFieldType.Text,
      },
      description: {
        blockId: 'description_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
