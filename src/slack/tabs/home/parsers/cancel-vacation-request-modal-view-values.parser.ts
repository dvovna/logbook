import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { ISelectedOption } from 'src/slack/common/utils/parsing-utils';
import { CANCEL_REQUEST_BLOCK_ID } from 'src/slack/tabs/home/views/cancel-vacation-request-select-modal.view';

const cancelVacationRequestSchema = z.object({
  request: z
    .object({
      value: z.string().min(1, 'Choose a vacation request'),
      text: z.string().optional(),
    })
    .required(),
});

export interface ICancelVacationRequestFormData {
  request: ISelectedOption;
}

@Injectable()
export default class CancelVacationRequestModalViewValuesParser extends BaseValuesParser<ICancelVacationRequestFormData> {
  public constructor() {
    super(cancelVacationRequestSchema, {
      request: {
        blockId: CANCEL_REQUEST_BLOCK_ID,
        type: ViewFieldType.Select,
      },
    });
  }
}
