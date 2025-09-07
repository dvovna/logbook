import { View } from '@slack/types/dist/views';
import { AnyBlock } from '@slack/web-api';

export interface IBaseViewService<
  ViewParams = Record<string, unknown>,
  Metadata = Record<string, unknown>,
> {
  getView(viewParams: ViewParams, metadata: Metadata): View;
  getSuccessView(message: string): View;
  getGeneralErrorBlock(errorMessage: string): AnyBlock;
}

export default abstract class BaseModalView<
  ViewParams = Record<string, unknown>,
  Metadata = Record<string, unknown>,
> implements IBaseViewService<ViewParams, Metadata>
{
  public abstract getView(viewParams: ViewParams, metadata: Metadata): View;

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
