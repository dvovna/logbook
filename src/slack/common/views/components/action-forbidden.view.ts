import { View } from '@slack/types/dist/views';

export class ActionForbiddenView {
  public static getView(): View {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Forbidden' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':no_entry: You are *not allowed* to perform this action.',
          },
        },
      ],
    };
  }
}
