import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import { IUserViewModel } from 'src/users/types/user.interface';

interface IGetViewParams {
  user: IUserViewModel;
  errorMessage?: string;
  pageMetadata?: string;
}

export type IChangeUserStatusModalViewMetadata = {
  userId: string;
  pageMetadata?: string;
};

@Injectable()
export default class ChangeUserStatusModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({ user, errorMessage, pageMetadata }: IGetViewParams): View {
    const actionName = user.is_active ? 'Deactivate' : 'Activate';

    return {
      type: 'modal',
      callback_id: ViewCallbackId.ChangeUserStatus,
      private_metadata: JSON.stringify({
        userId: user.id,
        pageMetadata,
      } as IChangeUserStatusModalViewMetadata),
      title: {
        type: 'plain_text',
        text: `${actionName} User`,
      },
      submit: {
        type: 'plain_text',
        text: actionName,
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
            text: `:alert: The user *${user.name}* will be ${user.is_active ? 'deactivated' : 'activated'}.`,
          },
        },
      ],
    };
  }
}
