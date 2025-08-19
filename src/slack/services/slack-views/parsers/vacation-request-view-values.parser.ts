import { z } from 'zod';
import BaseValuesParser from 'src/slack/services/slack-views/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import VacationType from 'src/common/enums/vacation-type.enum';

export const vacationRequestSchema = z
  .object({
    startDate: z.string().min(1, { message: 'Start date is required' }),
    endDate: z.string().min(1, { message: 'End date is required' }),
    type: z.enum(Object.values(VacationType), {
      message: 'Invalid vacation type',
    }),
    comment: z.string().optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine(
    (data) =>
      data.type !== VacationType.Other ||
      (data.comment && data.comment.trim().length > 0),
    {
      message: 'Comment is required when type is Other',
      path: ['comment'],
    },
  );

interface IVacationRequestViewData {
  startDate: string;
  endDate: string;
  type: VacationType;
  comment?: string;
}

@Injectable()
export default class VacationRequestViewValuesParser extends BaseValuesParser<IVacationRequestViewData> {
  public constructor() {
    super(vacationRequestSchema, {
      startDate: {
        blockId: 'start_date_block',
        type: ViewFieldType.Date,
      },
      endDate: {
        blockId: 'end_date_block',
        type: ViewFieldType.Date,
      },
      type: {
        blockId: 'type_block',
        type: ViewFieldType.Text,
      },
      comment: {
        blockId: 'comment_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
