import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_PROJECT_NAME_LENGTH = 50;

export const projectFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters`,
    ),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
    .optional(),
  clientId: z.string().uuid().optional(),
  status: z
    .object({
      value: z.enum(Object.values(ProjectStatus)),
      text: z.string(),
    }),
  billable: z
    .object({
      value: z.enum(['true', 'false']),
      text: z.string(),
    }),
});

export interface IProjectFormViewData {
  name: string;
  description?: string;
  clientId?: string;
  status: ISelectedOption<ProjectStatus>;
  billable?: ISelectedOption<'true' | 'false'>;
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
      clientId: {
        blockId: 'client_block',
        type: ViewFieldType.Select,
      },
      status: {
        blockId: 'status_block',
        type: ViewFieldType.Select,
      },
      billable: {
        blockId: 'billable_block',
        type: ViewFieldType.RadioButtons,
      },
    });
  }
}
