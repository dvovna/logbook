import { z } from 'zod';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const getHolidayFormSchema = ({
  minYear,
  maxYear,
}: {
  minYear: number;
  maxYear: number;
}) =>
  z.object({
    name: z.string().min(1, 'Holiday name is required'),
    date: z
      .string()
      .min(1, 'Holiday date is required')
      .refine((val) => {
        const year = new Date(val).getFullYear();
        return year >= minYear && year <= maxYear;
      }, `Holiday year must be between ${minYear} and ${maxYear}`),
  });

export interface IHolidayFormViewData {
  name: string;
  date: string;
}

@Injectable()
export default class HolidayModalViewValuesParser extends BaseValuesParser<IHolidayFormViewData> {
  public constructor(configService: ConfigService) {
    super(
      getHolidayFormSchema({
        minYear: configService.getOrThrow<number>('MIN_YEAR'),
        maxYear: configService.getOrThrow<number>('MAX_YEAR'),
      }),
      {
        name: {
          blockId: 'name_block',
          type: ViewFieldType.Text,
        },
        date: {
          blockId: 'date_block',
          type: ViewFieldType.Date,
        },
      },
    );
  }
}
