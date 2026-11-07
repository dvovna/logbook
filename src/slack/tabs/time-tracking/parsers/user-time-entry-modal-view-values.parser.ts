import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';

export const MAX_DESCRIPTION_LENGTH = 200;
const MAX_HOURS = 24;

// The client and billability come from the project, so the form has no
// fields for them.
export const timeEntryFormSchema = z.object({
  description: z
    .string()
    .max(
      MAX_DESCRIPTION_LENGTH,
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    )
    .optional(),
  projectId: z
    .object({
      value: z.string().min(1, 'Project is required'),
      text: z.string(),
    })
    .required(),
  hours: z
    .string()
    .refine(
      (val) => {
        const num = Number(val);

        return !isNaN(num) && num > 0 && num <= MAX_HOURS;
      },
      {
        message: `Hours must be a number between 0 and ${MAX_HOURS}`,
      },
    )
    .transform((val) => Number(val)),
  workDate: z.string().refine((dateStr) => !isNaN(Date.parse(dateStr)), {
    message: 'Invalid date format',
  }),
});

export interface ITimeEntryFormViewData {
  description?: string;
  projectId: ISelectedOption;
  hours: number;
  workDate: string;
}

export const TIME_ENTRY_FORM_FIELDS_CONFIG = {
  projectId: {
    blockId: 'project_block',
    type: ViewFieldType.Select,
  },
  description: {
    blockId: 'comment_block',
    type: ViewFieldType.Text,
  },
  hours: {
    blockId: 'hours_block',
    type: ViewFieldType.Text,
  },
  workDate: {
    blockId: 'date_block',
    type: ViewFieldType.Date,
  },
};

@Injectable()
export default class UserTimeEntryModalViewValuesParser extends BaseValuesParser<ITimeEntryFormViewData> {
  public constructor() {
    super(timeEntryFormSchema, TIME_ENTRY_FORM_FIELDS_CONFIG);
  }
}
