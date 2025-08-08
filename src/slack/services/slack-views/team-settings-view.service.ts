import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { ViewsOpenArguments } from '@slack/web-api/dist/types/request/views';
import { getValue } from 'src/slack/utils/view-utils';
import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';
import IBaseViewService from 'src/slack/services/slack-views/base.view-service';

@Injectable()
export class TeamSettingsViewService implements IBaseViewService {
  public getView(
    triggerId: string,
    metadata: IViewMetadata,
    { vacationDays, bonusDays }: { vacationDays: number; bonusDays: number },
  ): ViewsOpenArguments {
    return {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: ViewCallbackId.ChangeTeamSettings,
        private_metadata: JSON.stringify(metadata),
        title: {
          type: 'plain_text',
          text: 'Team Vacation Settings',
        },
        submit: {
          type: 'plain_text',
          text: 'Save',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '👋 Hello! Thank you for installing the Marina Bot.\n\nBefore we get started, please configure the number of vacation and bonus days for your team.',
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'vacation_days_block',
            label: {
              type: 'plain_text',
              text: 'Number of vacation days per year',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'vacation_days',
              placeholder: {
                type: 'plain_text',
                text: 'e.g. 20',
              },
              initial_value: vacationDays.toString(),
            },
          },
          {
            type: 'input',
            block_id: 'bonus_days_block',
            label: {
              type: 'plain_text',
              text: 'Number of bonus days per year',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'bonus_days',
              initial_value: bonusDays.toString(),
              placeholder: {
                type: 'plain_text',
                text: 'e.g. 3',
              },
            },
          },
        ],
      },
    };
  }

  public extractData(values: IViewStateValues): {
    vacationDays: number;
    bonusDays: number;
  } {
    const vacationDays = parseInt(
      getValue(values, 'vacation_days_block', 'vacation_days'),
      10,
    );
    const bonusDays = parseInt(
      getValue(values, 'bonus_days_block', 'bonus_days'),
      10,
    );

    if (isNaN(vacationDays) || isNaN(bonusDays)) {
      throw new Error(`Invalid numeric values in view input.`);
    }

    return { vacationDays, bonusDays };
  }
}
