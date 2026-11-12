// A CSV the app wrote, as its lines: without the byte order mark and the
// last line break.
export const csvLines = (content: string) =>
  content.replace('﻿', '').replace(/\r\n$/, '').split('\r\n');

export const BALANCES_TEMPLATE_HEADER =
  'Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left';

export const HISTORY_TEMPLATE_HEADER = 'Name,Email,Leave type,From,To,Comment';
