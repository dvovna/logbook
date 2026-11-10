import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';

interface IGetViewParams extends IBaseModalViewParams {
  title: string;
  message: string;
  callbackId: ViewCallbackId;
  // The buttons say what they do: by default the title ("Delete Team") and
  // "Cancel". At most 24 characters, like the title.
  confirmText?: string;
  cancelText?: string;
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

  protected getActionButtons(viewParams?: IGetViewParams): IActionButtons {
    return {
      submit: {
        type: 'plain_text',
        text: viewParams?.confirmText ?? viewParams?.title ?? 'Confirm',
      },
      close: { type: 'plain_text', text: viewParams?.cancelText ?? 'Cancel' },
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
