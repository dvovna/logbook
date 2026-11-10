import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';

const importHolidaysSchema = z.object({
  country: z
    .object({
      value: z.string().min(1, 'Country is required'),
      text: z.string().optional(),
    })
    .required(),
});

export interface IImportHolidaysFormData {
  country: ISelectedOption;
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
