import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { AnyBlock } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import UserRole from '@common/enums/user-role.enum';

const TAB_TYPE = 'home';

export interface IBaseTabViewParams {
  userId: string;
  userRole: UserRole;
  backButtonActionId?: string;
}

export abstract class BaseTabView<
  GetParams extends IBaseTabViewParams,
  Metadata = unknown,
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
        blocks: await this.getTabBlocks(params, metadata),
      },
    };
  }

  protected async getTabBlocks(
    params: GetParams,
    metadata?: Metadata,
  ): Promise<AnyBlock[]> {
    return [
      ...this.getBackButtonBlocks(params),
      ...this.getTitleBlocks(params),
      ...(await this.getContentBlocks(params, metadata)),
    ];
  }

  protected getBackButtonBlocks(_params: GetParams): AnyBlock[] {
    return [];
  }

  protected getTitleBlocks(params: GetParams): AnyBlock[] {
    const titleAction = this.getTitleAccessory(params);

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: this.getTabTitle(params),
        },
        ...(titleAction ? { accessory: titleAction } : {}),
      },
    ];
  }

  protected abstract getTabTitle(params: GetParams): string;

  protected getTitleAccessory(
    _params: GetParams,
  ): SectionBlockAccessory | null {
    return null;
  }

  protected abstract getContentBlocks(
    params: GetParams,
    metadata?: Metadata,
  ): AnyBlock[] | Promise<AnyBlock[]>;
}
