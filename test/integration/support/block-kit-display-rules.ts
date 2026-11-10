import { SlackJson } from './block-kit';

// How the Slack client shows what it accepts, where that differs from what
// the app meant. Slack takes all of this without an error, so only someone
// looking at the screen would notice; each rule comes from such a look.
// block-kit-rules.ts has what Slack refuses.

type Problems = string[];

// The client shows five elements of an actions block and folds the rest
// into "+ N more": the navigation row once hid Reports and Settings so.
const MAX_SHOWN_ACTIONS = 5;

// Markdown that Slack's mrkdwn does not have: it shows the characters.
const MARKDOWN_ONLY = [
  { pattern: /\*\*[^*\n]+\*\*/, what: '**bold** (mrkdwn bold is *bold*)' },
  {
    pattern: /\[[^\]\n]+\]\((https?:|mailto:)[^)\n]*\)/,
    what: '[label](url) (a mrkdwn link is <url|label>)',
  },
  { pattern: /^#{1,6} /m, what: '# heading' },
  { pattern: /~~[^~\n]+~~/, what: '~~strike~~ (mrkdwn strike is ~strike~)' },
];

// Formatting, mentions and links in plain_text, which shows them as typed.
const MARKUP_IN_PLAIN = [
  { pattern: /(^|\s)\*[^*\s][^*\n]*\*(?=\s|$)/, what: '*bold*' },
  { pattern: /(^|\s)_[^_\s][^_\n]*_(?=\s|$)/, what: '_italic_' },
  { pattern: /<[@#!][^>]*>/, what: 'a <@mention>' },
  { pattern: /<(https?|mailto):[^>]*>/, what: 'a <link>' },
];

// Every text object in `value`, with where it is.
const textsIn = (
  value: unknown,
  at: string,
): { text: SlackJson; at: string }[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => textsIn(item, `${at}[${i}]`));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const object = value as SlackJson;

  if (
    (object.type === 'plain_text' || object.type === 'mrkdwn') &&
    typeof object.text === 'string'
  ) {
    return [{ text: object, at }];
  }

  return Object.entries(object).flatMap(([key, child]) =>
    textsIn(child, `${at}.${key}`),
  );
};

const textProblems = (value: unknown, at: string): Problems =>
  textsIn(value, at).flatMap(({ text, at: textAt }) =>
    (text.type === 'mrkdwn' ? MARKDOWN_ONLY : MARKUP_IN_PLAIN)
      .filter(({ pattern }) => pattern.test(text.text))
      .map(
        ({ what }) =>
          `${textAt}: ${text.type} shows ${what} as typed: ${JSON.stringify(text.text)}`,
      ),
  );

// Every element of type `type` in `value`, with where it is.
const elementsIn = (
  value: unknown,
  type: string,
  at: string,
): { element: SlackJson; at: string }[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => elementsIn(item, type, `${at}[${i}]`));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const object = value as SlackJson;

  return [
    ...(object.type === type ? [{ element: object, at }] : []),
    ...Object.entries(object).flatMap(([key, child]) =>
      elementsIn(child, type, `${at}.${key}`),
    ),
  ];
};

const blocksDisplayProblems = (blocks: SlackJson[] = []): Problems => [
  ...blocks.flatMap((block, i) =>
    block.type === 'actions' && block.elements?.length > MAX_SHOWN_ACTIONS
      ? [
          `blocks[${i}]: Slack shows ${MAX_SHOWN_ACTIONS} of its ${block.elements.length} elements and folds the rest into "+ ${block.elements.length - MAX_SHOWN_ACTIONS} more"`,
        ]
      : [],
  ),
  // One choice behind ⋯ is a click more than a button, and hidden.
  ...elementsIn(blocks, 'overflow', 'blocks')
    .filter(({ element }) => element.options?.length === 1)
    .map(
      ({ element, at }) =>
        `${at}: an overflow menu with one option (${element.options[0].text?.text}): make it a button`,
    ),
  ...blocks.flatMap((block, i) =>
    block.type === 'divider' && blocks[i + 1]?.type === 'divider'
      ? [`blocks[${i}]: two dividers in a row`]
      : [],
  ),
  ...textProblems(blocks, 'blocks'),
];

const asSent = (value: unknown): SlackJson =>
  JSON.parse(JSON.stringify(value ?? {}));

export const viewDisplayProblems = (sentView: unknown): Problems => {
  const view = asSent(sentView);

  return [
    ...textProblems(
      { title: view.title, submit: view.submit, close: view.close },
      'view',
    ),
    ...blocksDisplayProblems(view.blocks),
  ];
};

export const messageDisplayProblems = (message: unknown): Problems => {
  const { blocks, text } = asSent(message);

  return blocks?.length
    ? blocksDisplayProblems(blocks)
    : textProblems({ type: 'mrkdwn', text: text ?? '' }, 'text');
};
