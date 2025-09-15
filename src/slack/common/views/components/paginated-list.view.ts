import { AnyBlock } from '@slack/web-api';
import { ISearchResult } from 'src/common/types/pagination.types';
import PaginationView from 'src/slack/common/views/components/pagination.view';

interface IPaginatedListViewParams<Item = unknown> {
  itemsData: ISearchResult<Item>;
  prevPageActionId: string;
  nextPageActionId: string;
  emptyText?: string;
  getItemBlocks: (item: Item) => AnyBlock[];
}

export class PaginatedListView {
  public static getBlocks<Item = unknown>({
    itemsData,
    getItemBlocks,
    prevPageActionId,
    nextPageActionId,
    emptyText = 'No items found',
  }: IPaginatedListViewParams<Item>) {
    const blocks: AnyBlock[] = [];

    if (itemsData.items.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: emptyText },
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
