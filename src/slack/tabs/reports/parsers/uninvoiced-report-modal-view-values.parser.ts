import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';

// Both dates are optional: none is all time.
const uninvoicedReportSchema = z
  .object({
    fromDate: z.string().nullish(),
    toDate: z.string().nullish(),
  })
  .refine(
    ({ fromDate, toDate }) => !fromDate || !toDate || toDate >= fromDate,
    {
      message: 'End date must not be before the start date',
      path: ['toDate'],
    },
  );

export interface IUninvoicedReportFormViewData {
  fromDate?: string | null;
  toDate?: string | null;
}

@Injectable()
export default class UninvoicedReportModalViewValuesParser extends BaseValuesParser<IUninvoicedReportFormViewData> {
  public constructor() {
    super(uninvoicedReportSchema, {
      fromDate: { blockId: 'from_date_block', type: ViewFieldType.Date },
      toDate: { blockId: 'to_date_block', type: ViewFieldType.Date },
    });
  }
}
