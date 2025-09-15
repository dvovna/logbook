import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';

interface IGetViewParams extends IBaseModalViewParams {
  title: string;
  message: string;
  callbackId: ViewCallbackId;
}

export interface IConfirmationModalViewMetadata {
  id: string;
  pageMetadata?: string;
}

@Injectable()
export default class ConfirmationModalView extends BaseModalView<
  IGetViewParams,
  IConfirmationModalViewMetadata
> {
  protected getTitleText(viewParams: IGetViewParams): string {
    return viewParams.title;
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Confirm' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({ message, errorMessage }: IGetViewParams): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message,
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
