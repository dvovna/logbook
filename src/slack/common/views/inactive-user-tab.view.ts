import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { Injectable } from '@nestjs/common';
import { FallbackTabViewActionId } from '@modules/slack/common/views/fallback-tab.view';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';

@Injectable()
export class InactiveUserTabView extends BaseTabView<IBaseTabViewParams> {
  protected callbackId = ViewCallbackId.FallbackTabView;

  protected getTabTitle(): string {
    return '*Your Logbook access is turned off*';
  }

  public getContentBlocks() {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Ask an admin of this workspace to turn it back on, then try again.',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Try again',
            },
            value: `${FallbackTabViewActionId.Retry}:${TabId.Home}`,
            action_id: FallbackTabViewActionId.Retry,
          },
        ],
      },
    ];
  }
}
