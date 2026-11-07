import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';

// "Ada, Bob, Carl and 2 more": names in a list item, escaped.
export const listNames = (names: string[], shown = 5) => {
  const listed = names.slice(0, shown).map(escapeMrkdwn).join(', ');

  return names.length > shown
    ? `${listed} and ${names.length - shown} more`
    : listed;
};
