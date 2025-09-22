import {
  BaseTabView,
  IBaseTabViewParams,
} from 'src/slack/common/views/base-tab.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { Injectable } from '@nestjs/common';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

export enum FallbackTabViewActionId {
  Retry = 'retry_home_tab',
}

interface IFallbackTabViewParams extends IBaseTabViewParams {
  tabId: TabId;
}

@Injectable()
export class FallbackTabView extends BaseTabView<IFallbackTabViewParams> {
  protected callbackId = ViewCallbackId.FallbackTabView;

  protected getTabTitle(): string {
    return `😬 *Oops!* Something went wrong while loading your vacation info...`;
  }

  public getContentBlocks({ tabId }: IFallbackTabViewParams) {
    return [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: "Don't worry, it's not you — it's us 🚧",
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Try Again',
              emoji: true,
            },
            value: `${FallbackTabViewActionId.Retry}:${tabId}`,
            action_id: FallbackTabViewActionId.Retry,
          },
        ],
      },
    ];
  }
}
