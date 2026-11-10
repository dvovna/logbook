import { AnyBlock } from '@slack/web-api';

export class Divider {
  public static getBlocks() {
    return [{ type: 'divider' }];
  }

  // Lists, pagination and filters each end with a divider, so where one
  // part of a screen meets the next there can be two: Slack draws both.
  public static withoutRepeated(blocks: AnyBlock[]): AnyBlock[] {
    return blocks.filter(
      (block, i) =>
        block.type !== 'divider' || blocks[i - 1]?.type !== 'divider',
    );
  }
}
