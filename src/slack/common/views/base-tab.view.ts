import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { AnyBlock } from '@slack/web-api';

const TAB_TYPE = 'home';

export interface IBaseTabViewParams {
  userId: string;
  backButtonActionId?: string;
}

export abstract class BaseTabView<
  GetParams extends IBaseTabViewParams,
  Metadata,
> {
  protected abstract callbackId: ViewCallbackId;

  public async getView(
    params: GetParams,
    metadata?: Metadata,
  ): Promise<ViewsPublishArguments> {
    return {
      user_id: params.userId,
      view: {
        type: TAB_TYPE,
        private_metadata: JSON.stringify(metadata ?? {}),
        callback_id: this.callbackId,
        blocks: await this.getTabContentBlocks(params, metadata),
      },
    };
  }

  protected abstract getTabContentBlocks(
    params: GetParams,
    metadata?: Metadata,
  ): AnyBlock[] | Promise<AnyBlock[]>;
}
