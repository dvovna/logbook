import { InputBlock, SectionBlock } from '@slack/web-api';
import { IOption } from 'src/slack/common/types/option.interface';
import { toPlainTextOption } from 'src/slack/common/utils/view.utils';

interface ISelectViewParams {
  blockId: string;
  actionId: string;
  label: string;
  options: IOption[];
  initialValues?: string[];
  optional?: boolean;
}

export class SlackInputCheckboxesView {
  public static getView({
    blockId,
    actionId,
    label,
    options,
    initialValues = [],
    optional = false,
  }: ISelectViewParams): [InputBlock] | SectionBlock[] {
    const formattedOptions = options.map(toPlainTextOption);

    return [
      {
        type: 'input',
        block_id: blockId,
        optional,
        element: {
          type: 'checkboxes',
          action_id: actionId,
          options: formattedOptions,
          ...(initialValues.length && {
            initial_options: formattedOptions.filter((option) =>
              initialValues.includes(option.value!),
            ),
          }),
        },
        label: {
          type: 'plain_text',
          text: label,
        },
      },
    ];
  }
}
