// Slack reads `<...>` in mrkdwn as a link, a mention (<!channel>) or a user
// reference, and `&` starts an entity. Text people typed (comments, reasons,
// descriptions, names) is escaped before it goes into mrkdwn, so it shows as
// typed and nobody can put a disguised link into a message from the bot.
export const escapeMrkdwn = (text: string | null | undefined) =>
  (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Someone's words as a quote, every line of it, safe to put in mrkdwn.
export const quoteMrkdwn = (text: string) =>
  `>${escapeMrkdwn(text).replace(/\n/g, '\n>')}`;
