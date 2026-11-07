import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { MAX_COMMENT_LENGTH } from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';

const schema = z.object({
  // Blank counts as missing: the database refuses a comment of spaces.
  comment: z
    .string()
    .trim()
    .min(1, { message: 'Comment is required' })
    .max(
      MAX_COMMENT_LENGTH,
      `Comment must be at most ${MAX_COMMENT_LENGTH} characters`,
    ),
});

export interface ICommentFormViewData {
  comment: string;
}

@Injectable()
export default class CommentModalViewValuesParser extends BaseValuesParser<ICommentFormViewData> {
  public constructor() {
    super(schema, {
      comment: {
        blockId: 'comment_block',
        type: ViewFieldType.Text,
      },
    });
  }
}
