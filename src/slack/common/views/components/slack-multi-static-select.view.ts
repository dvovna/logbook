import { InputBlock, SectionBlock } from '@slack/web-api';
import { IOption } from '@common/types/option.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

interface ISelectViewParams {
  blockId: string;
  actionId: string;
  label: string;
  placeholder: string;
  options: IOption[];
  initialValues?: string[];
  maxSelectedItems?: number;
  emptyText?: string;
  optional?: boolean;
  // Under the field, e.g. who can be chosen.
  hint?: string;
}

export class SlackMultiStaticSelectView {
  public static getView({
    blockId,
    actionId,
    label,
    placeholder,
    options,
    maxSelectedItems = 100,
    initialValues,
    emptyText,
    optional = false,
    hint,
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
        ...(hint ? { hint: { type: 'plain_text' as const, text: hint } } : {}),
        element: {
          type: 'multi_static_select',
          action_id: actionId,
          max_selected_items: maxSelectedItems,
          placeholder: {
            type: 'plain_text',
            text: placeholder,
          },
          options: formattedOptions,
          ...(initialValues?.length && {
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
