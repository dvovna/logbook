import { ActionsBlock, AnyBlock } from '@slack/web-api';
import { ActionsBlockElement } from '@slack/types/dist/block-kit/blocks';

interface IPaginationParams {
  page: number;
  pageSize?: number;
  totalCount: number;
  nextPageActionId: string;
  prevPageActionId: string;
}

const DEFAULT_PAGE_SIZE = 10;

export default class PaginationView {
  public static getBlocks({
    page,
    pageSize = DEFAULT_PAGE_SIZE,
    totalCount,
    prevPageActionId,
    nextPageActionId,
  }: IPaginationParams) {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `Total Count: ${totalCount}` },
    });

    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalPages <= 1) {
      return blocks;
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Page ${page} of ${totalPages}*`,
      },
    });

    const elements: ActionsBlockElement[] = [];

    if (page > 1) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '⬅ Prev' },
        action_id: prevPageActionId,
        value: String(page - 1),
      });
    }

    if (page < totalPages) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Next ➡' },
        action_id: nextPageActionId,
        value: String(page + 1),
      });
    }

    if (elements.length > 0) {
      blocks.push({
        type: 'actions',
        elements,
      } as ActionsBlock);
    }

    return blocks as ActionsBlock[];
  }
}
