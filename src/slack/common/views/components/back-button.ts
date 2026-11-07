export class BackButton {
  public static getBlocks(actionId: string) {
    return [
      {
        type: 'actions',
        elements: [
          {
            text: { type: 'plain_text', text: '⬅️ Back' },
            type: 'button',
            action_id: actionId,
          },
        ],
      },
    ];
  }
}
