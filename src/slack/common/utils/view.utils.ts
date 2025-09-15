import { IOption } from 'src/slack/common/types/option.interface';
import { PlainTextOption } from '@slack/web-api';

export const toPlainTextOption = ({ id, name }: IOption): PlainTextOption => {
  return {
    text: {
      type: 'plain_text',
      text: name,
    },
    value: id,
  };
};
