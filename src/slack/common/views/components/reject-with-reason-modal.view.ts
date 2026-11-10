import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { MAX_REJECTION_REASON_LENGTH } from '@common/constants/text-limits';

interface IGetViewParams extends IBaseModalViewParams {
  callbackId: ViewCallbackId;
  title: string;
  // What is being rejected, in mrkdwn, above the reason.
  summary?: string;
  // Who reads the reason, under the field.
  hint: string;
}

export interface IRejectWithReasonModalViewMetadata {
  id: string;
  // The tab to re-render after the decision; none when it came from a message.
  pageMetadata?: string;
}

// The Reject form of time entries and vacation requests: an optional reason
// that goes to the person along with the decision.
@Injectable()
export class RejectWithReasonModalView extends BaseModalView<
  IGetViewParams,
  IRejectWithReasonModalViewMetadata
> {
  protected getTitleText(params?: IGetViewParams): string {
    return params?.title ?? 'Reject';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Reject' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks(params?: IGetViewParams): AnyBlock[] {
    return [
      ...(params?.summary
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: params.summary },
            } as AnyBlock,
          ]
        : []),
      {
        type: 'input',
        block_id: 'reason_block',
        optional: true,
        label: { type: 'plain_text', text: 'Reason' },
        hint: { type: 'plain_text', text: params?.hint ?? '' },
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
