import { IOption } from '@modules/slack/common/types/option.interface';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

export const BILLABLE_PLAIN_TEXT_OPTIONS: IOption[] = [{
  name: 'Yes',
  id: YesNoValue.Yes,
}, {
  name: 'No',
  id: YesNoValue.No,
}];