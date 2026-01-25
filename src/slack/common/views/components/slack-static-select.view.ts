import { InputBlock, SectionBlock } from '@slack/web-api';
import { IOption } from '@modules/slack/common/types/option.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

interface ISelectViewParams<OptionType extends IOption = IOption> {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  options: OptionType[];
  initialValue?: string;
  emptyText?: string;
  optional?: boolean;
}

export class SlackStaticSelectView {
  public static getView({
    blockId,
    actionId,
    label,
    placeholder,
    options,
    initialValue,
    emptyText,
    optional = false,
  }: ISelectViewParams): [InputBlock] | SectionBlock[] {
    if (!options || options.length === 0) {
      return [
        {
          type: 'section',
          text: {
            type: 'plain_text',
            text: label,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: emptyText || `⚠️ *No ${label.toLowerCase()} available*.`,
          },
        },
      ];
    }

    const formattedOptions = options.map(toPlainTextOption);

    return [
      {
        type: 'input',
        block_id: blockId,
        optional,
        element: {
          type: 'static_select',
          action_id: actionId,
          placeholder: placeholder ? {
            type: 'plain_text',
            text: placeholder,
          } : undefined,
          options: formattedOptions,
          initial_option: formattedOptions.find(
            (option) => initialValue === option.value,
          ),
        },
        label: {
          type: 'plain_text',
          text: label,
        },
      },
    ];
  }
}
