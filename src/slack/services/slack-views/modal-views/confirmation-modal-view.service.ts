import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
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
  entityId: string;
  pageMetadata: string;
};

@Injectable()
export default class ConfirmationModalViewService extends BaseModalViewService<IGetViewParams> {
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
        entityId,
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
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message,
          },
        },
      ],
    };
  }
}
