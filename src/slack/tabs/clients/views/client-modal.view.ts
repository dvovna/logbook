import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_DESCRIPTION_LENGTH } from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';
import IClientViewModel from '@modules/clients/types/client.interface';

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: IClientViewModel | null;
}

export interface IClientModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

@Injectable()
export class ClientModalView extends BaseModalView<
  IGetViewParams,
  IClientModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ClientFormSubmit;

  protected getTitleText(viewParams: IGetViewParams): string {
    return viewParams.initialData ? 'Edit Client' : 'Create Client';
  }

  public getViewBlocks(params: IGetViewParams): AnyBlock[] {
    const { initialData, errorMessage } = params;

    return [
      {
        type: 'input',
        block_id: 'name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'name',
          initial_value: initialData?.name || '',
        },
        label: {
          type: 'plain_text',
          text: 'Client Name',
        },
      },
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          multiline: true,
          action_id: 'description',
          max_length: MAX_DESCRIPTION_LENGTH,
          initial_value: initialData?.description || '',
        },
        label: {
          type: 'plain_text',
          text: 'Description',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
