import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { View } from '@slack/types/dist/views';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';

@Injectable()
export class VacationRequestModalViewService extends BaseModalViewService {
  public getView(): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.CreateVacationRequest,
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
                value: VacationType.AnnualLeave,
              },
              {
                text: { type: 'plain_text', text: 'Bonus Day' },
                value: VacationType.BonusDay,
              },
              {
                text: { type: 'plain_text', text: 'Sick Leave' },
                value: VacationType.SickLeave,
              },
              {
                text: { type: 'plain_text', text: 'Unpaid Leave' },
                value: VacationType.UnpaidLeave,
              },
              {
                text: { type: 'plain_text', text: 'Other' },
                value: VacationType.Other,
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
    };
  }
}
