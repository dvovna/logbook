import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';

export type IFiltersConfig = {
  type: 'static_select' | 'external_select' | 'checkboxes' | 'button';
  actionId: string;
  placeholder?: string;
  options?: PlainTextOption[];
  initialOption?: PlainTextOption;
  initialOptions?: PlainTextOption[];
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

    const elements = filtersConfigs.map((config) => {
      switch (config.type) {
        case 'static_select':
          return {
            type: 'static_select',
            action_id: config.actionId,
            placeholder: { type: 'plain_text', text: config.placeholder },
            options: config.options,
            initial_option: config.initialOption,
          };
        case 'external_select':
          return {
            type: 'external_select',
            action_id: config.actionId,
            placeholder: { type: 'plain_text', text: config.placeholder },
            min_query_length: config.minQueryLength,
            initial_option: config.initialOption,
          };
        case 'checkboxes':
          return {
            type: 'checkboxes',
            action_id: config.actionId,
            options: config.options,
            initial_options: config.initialOptions,
          };
        case 'button':
          return {
            type: 'button',
            action_id: config.actionId,
            text: { type: 'plain_text', text: config.text },
          };
      }
    });

    if (includeReset) {
      elements.push({
        type: 'button',
        action_id: resetButtonActionId,
        text: { type: 'plain_text', text: 'Reset' },
      });
    }

    blocks.push({
      type: 'actions',
      elements,
    } as AnyBlock);

    if (separator) {
      blocks.push(...SeparatorComponent.getBlocks());
    }

    return blocks;
  }
}
