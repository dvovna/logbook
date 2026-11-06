import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import {
  ITimeEntryFormViewData,
  TIME_ENTRY_FORM_FIELDS_CONFIG,
  timeEntryFormSchema,
} from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';

const adminTimeEntryFormSchema = timeEntryFormSchema.extend({
  [TimeEntriesTabViewActionId.SelectUser]: z
    .object({
      value: z.string().min(1, 'User is required'),
      text: z.string(),
    })
    .required(),
  status: z
    .object({
      value: z.enum(Object.values(TimeEntryStatus)),
      text: z.string(),
    })
    .required(),
});

// An admin also chooses whose time it is and its status.
export interface IAdminTimeEntryFormViewData extends ITimeEntryFormViewData {
  [TimeEntriesTabViewActionId.SelectUser]: ISelectedOption;
  status: ISelectedOption<TimeEntryStatus>;
}

@Injectable()
export default class AdminTimeEntryModalViewValuesParser extends BaseValuesParser<IAdminTimeEntryFormViewData> {
  public constructor() {
    super(adminTimeEntryFormSchema, {
      ...TIME_ENTRY_FORM_FIELDS_CONFIG,
      [TimeEntriesTabViewActionId.SelectUser]: {
        blockId: 'user_block',
        type: ViewFieldType.Select,
      },
      status: {
        blockId: 'status_block',
        type: ViewFieldType.Select,
      },
    });
  }
}
