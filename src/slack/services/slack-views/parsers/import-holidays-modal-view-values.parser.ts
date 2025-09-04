import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import BaseValuesParser from 'src/slack/services/slack-views/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';

const importHolidaysSchema = z.object({
  country: z.string().min(1, 'Country selection is required'),
});

export interface IImportHolidaysFormData {
  country: string;
}

@Injectable()
export default class ImportHolidaysModalViewValuesParser extends BaseValuesParser<IImportHolidaysFormData> {
  public constructor() {
    super(importHolidaysSchema, {
      country: {
        blockId: 'country_block',
        type: ViewFieldType.Select,
      },
    });
  }
}
