import {
  BaseTabView,
  IBaseTabViewParams,
} from 'src/slack/common/views/base-tab.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { Injectable } from '@nestjs/common';
import { FallbackTabViewActionId } from 'src/slack/common/views/fallback-tab.view';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

@Injectable()
export class InactiveUserTabView extends BaseTabView<IBaseTabViewParams> {
  protected callbackId = ViewCallbackId.FallbackTabView;

  protected getTabTitle(): string {
    return `👋 Hey there!  
Looks like your account is not active yet 🚧`;
  }

  public getContentBlocks() {
    return [
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔑 Please reach out to your admin to get access.  
Meanwhile, grab a ☕ and relax 😎`,
        },
      },
      {
        type: 'image',
        image_url:
          'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExa2t1NG16dDZvM3Z6ZGpiNmN6OXZ6eDFzZmxnNWw5cDg3NzQyNGdyMiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/w8aLJLt9fA3M0/giphy.gif',
        alt_text: 'funny waiting gif',
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
