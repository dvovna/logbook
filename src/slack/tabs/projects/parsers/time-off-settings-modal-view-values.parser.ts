import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { hoursSchema } from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { timeOffBlockId } from '@modules/slack/tabs/projects/views/time-off-settings-modal.view';
import VacationType from '@common/enums/vacation-type.enum';
import { TIME_OFF_LEAVE_TYPES } from 'src/time-off-logging/constants/time-off-leave-types';

const projectSchema = z
  .object({ value: z.string().min(1), text: z.string() })
  .optional();

// The fields are named as the domain names them (`hours`, and a leave type
// for its project), so an error of the domain lands at its field.
const timeOffSettingsFormSchema = z.object({
  hours: hoursSchema,
  annual_leave: projectSchema,
  bonus_day: projectSchema,
  sick_leave: projectSchema,
  unpaid_leave: projectSchema,
});

export interface ITimeOffSettingsFormViewData {
  hours: number;
  annual_leave?: ISelectedOption;
  bonus_day?: ISelectedOption;
  sick_leave?: ISelectedOption;
  unpaid_leave?: ISelectedOption;
}

const leaveTypeFields = Object.fromEntries(
  TIME_OFF_LEAVE_TYPES.map((type: VacationType) => [
    type,
    { blockId: timeOffBlockId(type), type: ViewFieldType.Select },
  ]),
);

@Injectable()
export default class TimeOffSettingsModalViewValuesParser extends BaseValuesParser<ITimeOffSettingsFormViewData> {
  public constructor() {
    super(timeOffSettingsFormSchema, {
      hours: { blockId: 'hours_block', type: ViewFieldType.Text },
      ...leaveTypeFields,
    } as ConstructorParameters<
      typeof BaseValuesParser<ITimeOffSettingsFormViewData>
    >[1]);
  }
}
