import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import IHolidayViewModel from 'src/holidays/types/holiday.interface';

interface IGetViewParams {
  pageMetadata: string;
  holiday?: IHolidayViewModel | null;
  errorMessage?: string;
}

export type IHolidayModalViewMetadata = {
  holidayIdToEdit: string | null;
  pageMetadata: string;
};

@Injectable()
export class HolidayModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({
    holiday,
    errorMessage,
    pageMetadata,
  }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.HolidayFormSubmit,
      private_metadata: JSON.stringify({
        holidayIdToEdit: holiday?.id,
        pageMetadata,
      } as IHolidayModalViewMetadata),
      title: {
        type: 'plain_text',
        text: holiday ? 'Edit Holiday' : 'Create Holiday',
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
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name',
            initial_value: holiday?.name || '',
          },
          label: {
            type: 'plain_text',
            text: 'Holiday Name',
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          element: {
            type: 'datepicker',
            action_id: 'date',
            initial_date: holiday?.date,
          },
          label: {
            type: 'plain_text',
            text: 'Date',
          },
        },
      ],
    };
  }
}
