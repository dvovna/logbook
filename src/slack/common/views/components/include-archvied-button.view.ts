import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

const getArchivedPlainTextOptions = (title: string) => [
  toPlainTextOption({
    name: title,
    id: YesNoValue.Yes,
  }),
];

interface IIncludeArchivedButtonViewParams {
  includeArchived?: boolean;
  title?: string;
  actionId: string;
}

export class IncludeArchivedButtonView {
  public static getView({
    actionId,
    includeArchived = false,
    title = 'Include archived items',
  }: IIncludeArchivedButtonViewParams) {
    const options = getArchivedPlainTextOptions(title);

    return {
      type: 'actions',
      elements: [
        {
          type: 'checkboxes',
          action_id: actionId,
          options,
          initial_options: includeArchived ? options : undefined,
        },
      ],
    };
  }
}
