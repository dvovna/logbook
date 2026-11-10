import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import {
  TimeReportFilterId,
  TimeReportKind,
} from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import {
  daysInPeriod,
  MAX_REPORT_DAYS,
} from 'src/time-entries/utils/report-period';

// An optional filter: nothing chosen is no filter.
const selectedOption = z
  .object({ value: z.string().min(1), text: z.string() })
  .nullish();

const timeReportSchema = z
  .object({
    kind: z.object(
      { value: z.enum(TimeReportKind), text: z.string() },
      { message: 'Choose a report' },
    ),
    fromDate: z
      .string({ message: 'Start date is required' })
      .min(1, 'Start date is required'),
    toDate: z
      .string({ message: 'End date is required' })
      .min(1, 'End date is required'),
    [TimeReportFilterId.Client]: selectedOption,
    [TimeReportFilterId.Project]: selectedOption,
    [TimeReportFilterId.Person]: selectedOption,
  })
  .refine(({ fromDate, toDate }) => toDate >= fromDate, {
    message: 'End date must not be before the start date',
    path: ['toDate'],
  })
  .refine(
    ({ fromDate, toDate }) => daysInPeriod(fromDate, toDate) <= MAX_REPORT_DAYS,
    { message: 'Choose a period of a year at most', path: ['toDate'] },
  );

export interface ITimeReportFormViewData {
  kind: ISelectedOption<TimeReportKind>;
  fromDate: string;
  toDate: string;
  [TimeReportFilterId.Client]?: ISelectedOption | null;
  [TimeReportFilterId.Project]?: ISelectedOption | null;
  [TimeReportFilterId.Person]?: ISelectedOption | null;
}

@Injectable()
export default class TimeReportModalViewValuesParser extends BaseValuesParser<ITimeReportFormViewData> {
  public constructor() {
    super(timeReportSchema, {
      kind: { blockId: 'kind_block', type: ViewFieldType.Select },
      fromDate: { blockId: 'from_date_block', type: ViewFieldType.Date },
      toDate: { blockId: 'to_date_block', type: ViewFieldType.Date },
      [TimeReportFilterId.Client]: {
        blockId: `${TimeReportFilterId.Client}_block`,
        type: ViewFieldType.Select,
      },
      [TimeReportFilterId.Project]: {
        blockId: `${TimeReportFilterId.Project}_block`,
        type: ViewFieldType.Select,
      },
      [TimeReportFilterId.Person]: {
        blockId: `${TimeReportFilterId.Person}_block`,
        type: ViewFieldType.Select,
      },
    });
  }
}
