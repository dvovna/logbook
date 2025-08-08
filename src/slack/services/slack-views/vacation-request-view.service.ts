import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { ViewsOpenArguments } from '@slack/web-api/dist/types/request/views';
import {
  getOptionalValue,
  getSelectedDate,
  getSelectedOption,
} from 'src/slack/utils/view-utils';
import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';
import IBaseViewService from 'src/slack/services/slack-views/base.view-service';

@Injectable()
export class VacationRequestViewService implements IBaseViewService {
  public getView(
    triggerId: string,
    metadata: IViewMetadata,
  ): ViewsOpenArguments {
    return {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: ViewCallbackId.CreateVacationRequest,
        private_metadata: JSON.stringify(metadata),
        title: { type: 'plain_text', text: 'Request Vacation' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'start_date_block',
            label: { type: 'plain_text', text: 'Start Date' },
            element: {
              type: 'datepicker',
              action_id: 'start_date',
              placeholder: { type: 'plain_text', text: 'Select a date' },
            },
          },
          {
            type: 'input',
            block_id: 'end_date_block',
            label: { type: 'plain_text', text: 'End Date' },
            element: {
              type: 'datepicker',
              action_id: 'end_date',
              placeholder: { type: 'plain_text', text: 'Select a date' },
            },
          },
          {
            type: 'input',
            block_id: 'type_block',
            label: { type: 'plain_text', text: 'Vacation Type' },
            element: {
              type: 'static_select',
              action_id: 'type',
              options: [
                {
                  text: { type: 'plain_text', text: 'Annual Leave' },
                  value: 'annual_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Bonus Day' },
                  value: 'bonus_day',
                },
                {
                  text: { type: 'plain_text', text: 'Sick Leave' },
                  value: 'sick_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Unpaid Leave' },
                  value: 'unpaid_leave',
                },
                {
                  text: { type: 'plain_text', text: 'Other' },
                  value: 'other',
                },
              ],
            },
          },
          {
            type: 'input',
            optional: true,
            block_id: 'comment_block',
            label: { type: 'plain_text', text: 'Comment (optional)' },
            element: {
              type: 'plain_text_input',
              action_id: 'comment',
              multiline: true,
            },
          },
        ],
      },
    };
  }

  public extractData(values: IViewStateValues) {
    const startDate = getSelectedDate(values, 'start_date_block', 'start_date');
    const endDate = getSelectedDate(values, 'end_date_block', 'end_date');
    const type = getSelectedOption(values, 'type_block', 'type');
    const comment = getOptionalValue(values, 'comment_block', 'comment');

    return {
      startDate,
      endDate,
      type,
      comment,
    };
  }
}
