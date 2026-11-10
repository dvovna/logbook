import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import VacationType from '@common/enums/vacation-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';

export const userVacationRequestSchema = z
  .object({
    start_date: z.string().min(1, { message: 'Start date is required' }),
    end_date: z.string().min(1, { message: 'End date is required' }),
    type_option: z
      .object({
        value: z.enum(Object.values(VacationType), {
          message: 'Invalid vacation type',
        }),
        text: z.string().optional(),
      })
      .required(),
    comment: z
      .string()
      .max(
        MAX_COMMENT_LENGTH,
        `Comment must be at most ${MAX_COMMENT_LENGTH} characters`,
      )
      .optional(),
  })
  .refine((data) => new Date(data.end_date) >= new Date(data.start_date), {
    message: 'End date must be after start date',
    path: ['end_date'],
  })
  .refine(
    (data) =>
      data.type_option.value !== VacationType.Other ||
      (data.comment && data.comment.trim().length > 0),
    {
      message: 'Comment is required when type is Other',
      path: ['comment'],
    },
  );

export interface IVacationRequestUserFormViewData {
  start_date: string;
  end_date: string;
  type_option: ISelectedOption<VacationType>;
  comment?: string;
}

export const FORM_FIELDS_CONFIG = {
  start_date: {
    blockId: 'start_date_block',
    type: ViewFieldType.Date,
  },
  end_date: {
    blockId: 'end_date_block',
    type: ViewFieldType.Date,
  },
  type_option: {
    blockId: 'type_block',
    type: ViewFieldType.Select,
  },
  comment: {
    blockId: 'comment_block',
    type: ViewFieldType.Text,
  },
};

@Injectable()
export default class VacationRequestUserViewValuesParser extends BaseValuesParser<IVacationRequestUserFormViewData> {
  public constructor() {
    super(userVacationRequestSchema, FORM_FIELDS_CONFIG);
  }
}
