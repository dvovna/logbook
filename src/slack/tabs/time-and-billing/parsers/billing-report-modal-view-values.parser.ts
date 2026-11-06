import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';

const billingReportSchema = z
  .object({
    clientId: z.object(
      { value: z.string().min(1), text: z.string() },
      { message: 'Client is required' },
    ),
    fromDate: z.string({ message: 'Start date is required' }).min(1, 'Start date is required'),
    toDate: z.string({ message: 'End date is required' }).min(1, 'End date is required'),
  })
  .refine(({ fromDate, toDate }) => toDate >= fromDate, {
    message: 'End date must not be before the start date',
    path: ['toDate'],
  });

export interface IBillingReportFormViewData {
  clientId: ISelectedOption;
  fromDate: string;
  toDate: string;
}

@Injectable()
export default class BillingReportModalViewValuesParser extends BaseValuesParser<IBillingReportFormViewData> {
  public constructor() {
    super(billingReportSchema, {
      clientId: { blockId: 'client_block', type: ViewFieldType.Select },
      fromDate: { blockId: 'from_date_block', type: ViewFieldType.Date },
      toDate: { blockId: 'to_date_block', type: ViewFieldType.Date },
    });
  }
}
