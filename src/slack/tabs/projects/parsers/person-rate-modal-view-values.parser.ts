import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { PersonRateModalActionId } from '@modules/slack/tabs/projects/enums/person-rate-modal-action-id.enum';
import { hourlyRateSchema } from '@modules/slack/tabs/projects/parsers/hourly-rate.schema';

const personRateFormSchema = z.object({
  [PersonRateModalActionId.Person]: z.object(
    { value: z.string().uuid(), text: z.string() },
    { message: 'Choose a person' },
  ),
  [PersonRateModalActionId.HourlyRate]: hourlyRateSchema,
});

export interface IPersonRateFormViewData {
  person: ISelectedOption;
  // Null removes the person's own rate.
  hourlyRate: number | null;
}

@Injectable()
export default class PersonRateModalViewValuesParser extends BaseValuesParser<IPersonRateFormViewData> {
  public constructor() {
    super(personRateFormSchema, {
      [PersonRateModalActionId.Person]: {
        blockId: 'person_block',
        type: ViewFieldType.Select,
      },
      [PersonRateModalActionId.HourlyRate]: {
        blockId: 'hourly_rate_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
