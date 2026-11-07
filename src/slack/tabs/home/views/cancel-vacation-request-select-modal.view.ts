import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';

export const CANCEL_REQUEST_BLOCK_ID = 'request_block';
export const CANCEL_REQUEST_ACTION_ID = 'request';

export interface ICancelVacationRequestSelectModalViewParams extends IBaseModalViewParams {
  requests: IVacationRequestViewModel[];
}

// Opened by `/vacations cancel`: the user picks one of their pending requests.
@Injectable()
export class CancelVacationRequestSelectModalView extends BaseModalView<ICancelVacationRequestSelectModalViewParams> {
  protected defaultCallbackId =
    ViewCallbackId.CancelVacationRequestCommandSubmit;

  protected getTitleText(): string {
    return 'Cancel Vacation';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Cancel Request' },
      close: { type: 'plain_text', text: 'Close' },
    };
  }

  protected getViewBlocks(
    params: ICancelVacationRequestSelectModalViewParams = { requests: [] },
  ): AnyBlock[] {
    const { requests, errorMessage } = params;

    return [
      {
        type: 'input',
        block_id: CANCEL_REQUEST_BLOCK_ID,
        label: { type: 'plain_text', text: 'Vacation request' },
        element: {
          type: 'static_select',
          action_id: CANCEL_REQUEST_ACTION_ID,
          placeholder: {
            type: 'plain_text',
            text: 'Choose a request to cancel',
          },
          options: requests.map((request) => ({
            text: { type: 'plain_text', text: this.getRequestLabel(request) },
            value: request.id,
          })),
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private getRequestLabel(request: IVacationRequestViewModel) {
    const type = VACATION_TYPE_DISPLAY_NAME_MAP[request.type] ?? 'Unknown';

    return `${request.start_date} – ${request.end_date} · ${type} · ${request.days} days`;
  }
}
