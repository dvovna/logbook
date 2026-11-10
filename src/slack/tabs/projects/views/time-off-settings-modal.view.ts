import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { truncate } from 'lodash';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import {
  MAX_SELECT_OPTIONS,
  toPlainTextOption,
} from '@modules/slack/common/utils/view.utils';
import {
  VACATION_TYPE_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import IProjectViewModel from 'src/projects/types/project.types';
import { ITimeOffSettings } from 'src/time-off-logging/types/time-off-settings.types';
import { TIME_OFF_LEAVE_TYPES } from 'src/time-off-logging/constants/time-off-leave-types';

// Slack's limit of an option's text.
const MAX_OPTION_TEXT = 75;

interface IGetViewParams extends IBaseModalViewParams {
  settings: ITimeOffSettings;
  // The workspace's active projects: any of them, not only the admin's.
  projects: IProjectViewModel[];
}

export interface ITimeOffSettingsModalViewMetadata {
  pageMetadata: string;
}

export const timeOffBlockId = (type: string) => `${type}_block`;

// The hours of a working day and a project for each leave type, for an admin.
@Injectable()
export class TimeOffSettingsModalView extends BaseModalView<
  IGetViewParams,
  ITimeOffSettingsModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.TimeOffSettingsForm;

  protected getTitleText(): string {
    return 'Time off projects';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({
    settings,
    projects,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const options = projects.slice(0, MAX_SELECT_OPTIONS).map(({ id, name }) =>
      toPlainTextOption({
        id,
        name: truncate(name, { length: MAX_OPTION_TEXT }),
      }),
    );

    return [
      {
        type: 'input',
        block_id: 'hours_block',
        label: { type: 'plain_text', text: 'Hours in a working day' },
        hint: {
          type: 'plain_text',
          text: 'A day of time off is logged as this many hours, in 15-minute steps: 8, or 7.5.',
        },
        element: {
          type: 'number_input',
          action_id: 'hours',
          is_decimal_allowed: true,
          min_value: '0.25',
          max_value: '24',
          initial_value: String(settings.minutesPerDay / 60),
        },
      },
      // Slack refuses a select with no options.
      ...(options.length ? TIME_OFF_LEAVE_TYPES : []).map((type): AnyBlock => {
        // A project archived since it was chosen is not among the options:
        // the field shows empty, and saving clears it.
        const selected = options.find(
          ({ value }) => value === settings.projectIds[type],
        );

        return {
          type: 'input',
          block_id: timeOffBlockId(type),
          optional: true,
          label: {
            type: 'plain_text',
            text: withIcon(VACATION_TYPE_LABELS[type]),
          },
          element: {
            type: 'static_select',
            action_id: type,
            placeholder: { type: 'plain_text', text: 'Not logged' },
            options,
            ...(selected ? { initial_option: selected } : {}),
          },
        };
      }),
      ...(options.length
        ? []
        : [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '_There are no projects yet: add one to log time off on it._',
              },
            } as AnyBlock,
          ]),
      {
        type: 'context',
        elements: [
          {
            type: 'plain_text',
            text: 'Approved time off of a type can be logged as time on its project. A type with no project is not logged. Other leave is never logged.',
          },
        ],
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
