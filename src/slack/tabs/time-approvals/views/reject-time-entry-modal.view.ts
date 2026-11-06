import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { MAX_REJECTION_REASON_LENGTH } from '@modules/slack/tabs/time-approvals/parsers/reject-time-entry-modal-view-values.parser';

export interface IRejectTimeEntryModalViewMetadata {
  id: string;
  pageMetadata?: string;
}

@Injectable()
export class RejectTimeEntryModalView extends BaseModalView<
  IBaseModalViewParams,
  IRejectTimeEntryModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.RejectTimeEntry;

  protected getTitleText(): string {
    return 'Reject Time Entry';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Reject' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks(params?: IBaseModalViewParams): AnyBlock[] {
    return [
      {
        type: 'input',
        block_id: 'reason_block',
        optional: true,
        label: { type: 'plain_text', text: 'Reason' },
        hint: {
          type: 'plain_text',
          text: 'Sent to the person along with the entry, so they can fix it.',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          multiline: true,
          max_length: MAX_REJECTION_REASON_LENGTH,
        },
      },
      ...(params?.errorMessage
        ? [this.getGeneralErrorBlock(params.errorMessage)]
        : []),
    ];
  }
}
