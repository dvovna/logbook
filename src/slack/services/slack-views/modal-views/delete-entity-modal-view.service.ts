import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import capitalize from 'src/common/utils/capitalize';

interface IGetViewParams {
  entityType: string;
  entityId: string;
  entityName: string;
  callbackId: ViewCallbackId;
  errorMessage?: string;
}

export type IDeleteEntityModalViewMetadata = {
  entityType: string;
  entityId: string;
};

@Injectable()
export default class DeleteEntityModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({
    entityType,
    entityId,
    entityName,
    errorMessage,
    callbackId,
  }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: callbackId,
      private_metadata: JSON.stringify({
        entityId,
        entityType,
      } as IDeleteEntityModalViewMetadata),
      title: {
        type: 'plain_text',
        text: `Delete ${capitalize(entityType)}`,
      },
      submit: {
        type: 'plain_text',
        text: 'Delete',
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
            text: `:alert: The ${entityType} *${entityName}* will be permanently deleted. This action cannot be undone.`,
          },
        },
      ],
    };
  }
}
