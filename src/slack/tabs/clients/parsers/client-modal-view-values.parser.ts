import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_CLIENT_NAME_LENGTH = 50;

const clientFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Client name is required')
    .max(
      MAX_CLIENT_NAME_LENGTH,
      `Client name must be at most ${MAX_CLIENT_NAME_LENGTH} characters`,
    ),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, 'Description must be at most 200 characters')
    .optional(),
});

export interface IClientFormViewData {
  name: string;
  description?: string;
}

@Injectable()
export default class ClientModalViewValuesParser extends BaseValuesParser<IClientFormViewData> {
  public constructor() {
    super(clientFormSchema, {
      name: {
        blockId: 'name_block',
        type: ViewFieldType.Text,
      },
      description: {
        blockId: 'description_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
