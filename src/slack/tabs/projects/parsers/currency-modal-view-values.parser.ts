import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';

// The code is checked against ISO 4217 by SlackTeamsService.setCurrency.
const currencyFormSchema = z.object({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Enter three letters, such as USD, EUR or GBP'),
});

export interface ICurrencyFormViewData {
  currency: string;
}

@Injectable()
export default class CurrencyModalViewValuesParser extends BaseValuesParser<ICurrencyFormViewData> {
  public constructor() {
    super(currencyFormSchema, {
      currency: { blockId: 'currency_block', type: ViewFieldType.Text },
    });
  }
}
