import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView from 'src/slack/common/views/base-modal.view';
import { View } from '@slack/types/dist/views';

interface IGetViewParams {
  title: string;
  message: string;
  entityId: string;
  callbackId: ViewCallbackId;
  errorMessage?: string;
  pageMetadata?: string;
}

export type IConfirmationModalViewMetadata = {
  entityType: string;
  id: string;
  pageMetadata: string;
};

@Injectable()
export default class ConfirmationModalView extends BaseModalView<IGetViewParams> {
  public getView({
    entityId,
    message,
    errorMessage,
    title,
    callbackId,
    pageMetadata,
  }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: callbackId,
      private_metadata: JSON.stringify({
        id: entityId,
        pageMetadata,
      } as IConfirmationModalViewMetadata),
      title: {
        type: 'plain_text',
        text: title,
      },
      submit: {
        type: 'plain_text',
        text: 'Confirm',
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
            text: message,
          },
        },
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
      ],
    };
  }
}
