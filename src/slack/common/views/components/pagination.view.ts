import { ActionsBlock, AnyBlock } from '@slack/web-api';
import { ActionsBlockElement } from '@slack/types/dist/block-kit/blocks';
import { Divider } from '@modules/slack/common/views/components/separator';

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
    const totalPages = Math.ceil(totalCount / pageSize);

    // "1–10 of 23" under the list; an empty list says so itself.
    if (totalCount > 0) {
      const from = (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, totalCount);

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              totalPages > 1
                ? `${from}–${to} of ${totalCount}`
                : `${totalCount} in total`,
          },
        ],
      });
    }

    if (totalPages <= 1) {
      return blocks;
    }

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

    blocks.push(...Divider.getBlocks());

    return blocks as ActionsBlock[];
  }
}
