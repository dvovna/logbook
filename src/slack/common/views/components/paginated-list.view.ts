import { AnyBlock } from '@slack/web-api';
import { ISearchResult } from '@common/types/pagination.types';
import PaginationView from '@modules/slack/common/views/components/pagination.view';

interface IPaginatedListViewParams<Item = unknown> {
  itemsData: ISearchResult<Item>;
  prevPageActionId: string;
  nextPageActionId: string;
  emptyText?: string;
  // The button that fills an empty list, e.g. "Create a team".
  emptyAction?: { text: string; actionId: string };
  getItemBlocks: (item: Item) => AnyBlock[];
}

export class PaginatedListView {
  public static getBlocks<Item = unknown>({
    itemsData,
    getItemBlocks,
    prevPageActionId,
    nextPageActionId,
    emptyText = 'No items found',
    emptyAction,
  }: IPaginatedListViewParams<Item>) {
    const blocks: AnyBlock[] = [];

    if (itemsData.items.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: emptyText },
        ...(emptyAction
          ? {
              accessory: {
                type: 'button',
                text: { type: 'plain_text', text: emptyAction.text },
                action_id: emptyAction.actionId,
              },
            }
          : {}),
      });
    } else {
      const itemBlocks = itemsData.items.map(getItemBlocks);

      blocks.push(...itemBlocks.flat());
    }

    blocks.push(
      ...PaginationView.getBlocks({
        page: itemsData.page,
        totalCount: itemsData.totalCount,
        pageSize: itemsData.pageSize,
        prevPageActionId,
        nextPageActionId,
      }),
    );

    return blocks;
  }
}
