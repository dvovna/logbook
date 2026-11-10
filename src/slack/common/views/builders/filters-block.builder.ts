import { AnyBlock } from '@slack/web-api';
import { Divider } from '@modules/slack/common/views/components/separator';
import { splitIntoRows } from '@modules/slack/common/views/components/actions-rows';
import { IOption } from '@common/types/option.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

export type IFiltersConfig<OptionType extends IOption = IOption> = {
  type:
    | 'static_select'
    | 'external_select'
    | 'checkboxes'
    | 'button'
    | 'datepicker';
  actionId: string;
  placeholder?: string;
  options?: OptionType[];
  initialValue?: string;
  initialValues?: string[];
  initialOption?: OptionType;
  minQueryLength?: number;
  text?: string;
};

export interface IFiltersBlockBuilderProps {
  filtersConfigs: IFiltersConfig[];
  headerText?: string;
  includeReset?: boolean;
  separator?: boolean;
  resetButtonActionId: string;
}

export class FiltersBlockBuilder {
  public static build({
    filtersConfigs,
    headerText = '*Filters*',
    includeReset = true,
    separator = true,
    resetButtonActionId,
  }: IFiltersBlockBuilderProps): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    if (headerText) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: headerText,
        },
      });
    }

    const elements = filtersConfigs
      .map((config) => {
        const mappedOptions = config.options?.length
          ? config.options.map(toPlainTextOption)
          : [];

        if (config.type === 'static_select' && !mappedOptions.length) {
          return;
        }

        const initialMappedOption = config.initialValue
          ? mappedOptions.find((option) => option.value === config.initialValue)
          : undefined;

        switch (config.type) {
          case 'static_select':
            return {
              type: 'static_select',
              action_id: config.actionId,
              placeholder: { type: 'plain_text', text: config.placeholder },
              options: mappedOptions,
              initial_option: initialMappedOption,
            };
          case 'external_select':
            return {
              type: 'external_select',
              action_id: config.actionId,
              placeholder: { type: 'plain_text', text: config.placeholder },
              min_query_length: config.minQueryLength,
              initial_option:
                config.initialOption && toPlainTextOption(config.initialOption),
            };
          case 'checkboxes':
            return {
              type: 'checkboxes',
              action_id: config.actionId,
              options: mappedOptions,
              initial_options: mappedOptions.filter((option) =>
                config.initialValues?.includes(option.value!),
              ),
            };
          case 'button':
            return {
              type: 'button',
              action_id: config.actionId,
              text: { type: 'plain_text', text: config.text },
            };
          case 'datepicker':
            return {
              type: 'datepicker',
              placeholder: { type: 'plain_text', text: config.placeholder },
              action_id: config.actionId,
              initial_date: config.initialValue,
            };
        }
      })
      .filter(Boolean);

    if (includeReset) {
      elements.push({
        type: 'button',
        action_id: resetButtonActionId,
        text: { type: 'plain_text', text: 'Reset' },
      });
    }

    blocks.push(
      ...splitIntoRows(elements).map(
        (row) => ({ type: 'actions', elements: row }) as AnyBlock,
      ),
    );

    if (separator) {
      blocks.push(...Divider.getBlocks());
    }

    return blocks;
  }
}
