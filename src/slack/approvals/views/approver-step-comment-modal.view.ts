import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';
import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';

export interface IApproverStepCommentModalViewMetadata {
  stepId: string;
}

@Injectable()
export class ApproverStepCommentModalView extends BaseModalView<
  IBaseModalViewParams,
  IApproverStepCommentModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ApproverMessageCommentFormSubmit;

  protected getTitleText() {
    return 'Add Comment';
  }

  public getViewBlocks({ errorMessage }: IBaseModalViewParams): AnyBlock[] {
    return [
      {
        type: 'input',
        block_id: 'comment_block',
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          initial_value: '',
          multiline: true,
          max_length: MAX_COMMENT_LENGTH,
        },
        label: {
          type: 'plain_text',
          text: 'Comment',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
