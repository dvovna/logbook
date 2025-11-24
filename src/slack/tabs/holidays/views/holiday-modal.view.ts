import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';
import { AnyBlock } from '@slack/web-api';

interface IGetViewParams extends IBaseModalViewParams {
  holiday?: IHolidayViewModel | null;
  initialDate?: string;
}

export interface IHolidayModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

@Injectable()
export class HolidayModalView extends BaseModalView<
  IGetViewParams,
  IHolidayModalViewMetadata
> {
  protected callbackId = ViewCallbackId.HolidayFormSubmit;

  protected getTitleText({ holiday }: IGetViewParams): string {
    return holiday ? 'Edit Holiday' : 'Create Holiday';
  }

  public getViewBlocks({
    holiday,
    errorMessage,
    initialDate,
  }: IGetViewParams): AnyBlock[] {
    return [
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
          initial_date: holiday?.date || initialDate,
        },
        label: {
          type: 'plain_text',
          text: 'Date',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
