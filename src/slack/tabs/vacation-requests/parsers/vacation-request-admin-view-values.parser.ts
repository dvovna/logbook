import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import {
  FORM_FIELDS_CONFIG,
  IVacationRequestUserFormViewData,
  MAX_COMMENT_LENGTH,
} from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';

export const adminVacationRequestSchema = z
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
    status: z
      .object({
        value: z.enum(Object.values(VacationRequestStatus), {
          message: 'Invalid vacation status',
        }),
        text: z.string().optional(),
      })
      .required(),
    [VacationRequestsTabViewActionId.UserField]: z
      .object({
        value: z.string().min(1, 'User is required'),
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

export interface IVacationRequestAdminFormViewData
  extends IVacationRequestUserFormViewData {
  [VacationRequestsTabViewActionId.UserField]: ISelectedOption;
  status: ISelectedOption<VacationRequestStatus>;
}

@Injectable()
export default class VacationRequestAdminViewValuesParser extends BaseValuesParser<IVacationRequestAdminFormViewData> {
  public constructor() {
    super(adminVacationRequestSchema, {
      ...FORM_FIELDS_CONFIG,
      [VacationRequestsTabViewActionId.UserField]: {
        blockId: 'user_id_block',
        type: ViewFieldType.Select,
      },
      status: {
        blockId: 'status_block',
        type: ViewFieldType.Select,
      },
    });
  }
}
