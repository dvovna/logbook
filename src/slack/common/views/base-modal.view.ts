import { View } from '@slack/types/dist/views';
import { AnyBlock } from '@slack/web-api';
import type { PlainTextElement } from '@slack/types/dist/block-kit/composition-objects';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

export interface IBaseModalViewParams<
  CallbackId extends ViewCallbackId = ViewCallbackId,
> {
  callbackId?: CallbackId;
  errorMessage?: string;
}

export interface IActionButtons {
  submit?: PlainTextElement;
  close: PlainTextElement;
}

export interface IBaseViewService<
  ViewParams extends IBaseModalViewParams,
  Metadata = Record<string, unknown>,
> {
  getView(viewParams: ViewParams, metadata: Metadata): View;
  getSuccessView(message: string): View;
  getGeneralErrorBlock(errorMessage: string): AnyBlock;
}

export default abstract class BaseModalView<
  ViewParams extends IBaseModalViewParams,
  Metadata = Record<string, unknown>,
> implements IBaseViewService<ViewParams, Metadata> {
  protected defaultCallbackId?: ViewCallbackId;

  public getView(viewParams?: ViewParams, metadata?: Metadata): View {
    return {
      type: 'modal',
      callback_id: viewParams?.callbackId || this.defaultCallbackId,
      private_metadata: JSON.stringify(metadata || {}),
      title: {
        type: 'plain_text',
        emoji: true,
        text: this.getTitleText(viewParams),
      },
      ...this.getActionButtons(viewParams),
      blocks: this.getViewBlocks(viewParams, metadata),
    };
  }

  protected abstract getViewBlocks(
    viewParams?: ViewParams,
    metadata?: Metadata,
  ): AnyBlock[];

  protected abstract getTitleText(viewParams?: ViewParams): string;

  protected getActionButtons(_viewParams?: ViewParams): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getSuccessView(message: string): View {
    return {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'Success',
      },
      close: {
        type: 'plain_text',
        text: 'Close',
      },
      blocks: [
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

  public getGeneralErrorBlock(errorMessage: string): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: ${errorMessage}`,
      },
    };
  }
}
