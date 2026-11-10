import { SlackJson } from './block-kit';

// What Slack checks before it accepts a view or a message: the fields each
// block and element may have, their limits, and that initial options are
// among the options. Slack answers anything else with invalid_arguments or
// invalid_blocks, so the user sees nothing. Not every rule is here; these
// are the ones the app's views run into.

type Problems = string[];

const PLAIN = 'plain_text';

const textProblems = (
  text: SlackJson | undefined,
  at: string,
  { max, plainOnly = false }: { max: number; plainOnly?: boolean },
): Problems => {
  if (!text) {
    return [];
  }

  const allowed =
    text.type === PLAIN
      ? ['type', 'text', 'emoji']
      : ['type', 'text', 'verbatim'];
  const problems = unknownKeys(text, allowed, at);

  if (text.type !== PLAIN && (plainOnly || text.type !== 'mrkdwn')) {
    problems.push(`${at}: must be a plain_text text object`);
  }

  if (typeof text.text !== 'string' || !text.text.length) {
    problems.push(`${at}.text: must be a non-empty string`);
  } else if (text.text.length > max) {
    problems.push(`${at}.text: longer than ${max} characters`);
  }

  return problems;
};

const unknownKeys = (object: SlackJson, allowed: string[], at: string) =>
  Object.keys(object)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${at}: unknown field ${key}`);

const optionProblems = (
  option: SlackJson,
  at: string,
  textType: 'plain' | 'any' = 'plain',
): Problems => [
  ...unknownKeys(option, ['text', 'value', 'description', 'url'], at),
  ...textProblems(option.text, `${at}.text`, {
    max: 75,
    plainOnly: textType === 'plain',
  }),
  ...textProblems(option.description, `${at}.description`, {
    max: 75,
    plainOnly: true,
  }),
  ...(typeof option.value !== 'string' || option.value.length > 150
    ? [`${at}.value: must be a string of at most 150 characters`]
    : []),
];

const sameOption = (a: SlackJson, b: SlackJson) =>
  a.value === b.value && a.text?.text === b.text?.text;

// Initial options must exactly match options of the element.
const initialOptionProblems = (element: SlackJson, at: string): Problems => {
  const options = [
    ...(element.options ?? []),
    ...(element.option_groups ?? []).flatMap((group) => group.options ?? []),
  ];
  const initial = [
    ...(element.initial_option ? [element.initial_option] : []),
    ...(element.initial_options ?? []),
  ];

  return initial
    .filter(
      (option) => !options.some((candidate) => sameOption(option, candidate)),
    )
    .map(
      (option) =>
        `${at}: initial option ${option.value} is not one of its options`,
    );
};

const COMMON = ['type', 'action_id', 'confirm', 'focus_on_load'];
const PLACEHOLDER = ['placeholder'];

const ELEMENT_FIELDS: Record<string, string[]> = {
  button: [
    'type',
    'action_id',
    'text',
    'url',
    'value',
    'style',
    'confirm',
    'accessibility_label',
  ],
  overflow: ['type', 'action_id', 'options', 'confirm'],
  static_select: [
    ...COMMON,
    ...PLACEHOLDER,
    'options',
    'option_groups',
    'initial_option',
  ],
  multi_static_select: [
    ...COMMON,
    ...PLACEHOLDER,
    'options',
    'option_groups',
    'initial_options',
    'max_selected_items',
  ],
  external_select: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_option',
    'min_query_length',
  ],
  multi_external_select: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_options',
    'min_query_length',
    'max_selected_items',
  ],
  users_select: [...COMMON, ...PLACEHOLDER, 'initial_user'],
  multi_users_select: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_users',
    'max_selected_items',
  ],
  checkboxes: [...COMMON, 'options', 'initial_options'],
  radio_buttons: [...COMMON, 'options', 'initial_option'],
  datepicker: [...COMMON, ...PLACEHOLDER, 'initial_date'],
  timepicker: [...COMMON, ...PLACEHOLDER, 'initial_time', 'timezone'],
  plain_text_input: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_value',
    'multiline',
    'min_length',
    'max_length',
    'dispatch_action_config',
  ],
  number_input: [
    ...COMMON,
    ...PLACEHOLDER,
    'is_decimal_allowed',
    'initial_value',
    'min_value',
    'max_value',
    'dispatch_action_config',
  ],
  email_text_input: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_value',
    'dispatch_action_config',
  ],
  url_text_input: [
    ...COMMON,
    ...PLACEHOLDER,
    'initial_value',
    'dispatch_action_config',
  ],
  image: ['type', 'image_url', 'alt_text', 'slack_file'],
};

const MAX_OPTIONS: Record<string, number> = {
  overflow: 5,
  checkboxes: 10,
  radio_buttons: 10,
  static_select: 100,
  multi_static_select: 100,
};

const elementProblems = (element: SlackJson, at: string): Problems => {
  const fields = ELEMENT_FIELDS[element.type];

  if (!fields) {
    return [`${at}: unknown element type ${element.type}`];
  }

  const problems = [
    ...unknownKeys(element, fields, at),
    ...textProblems(element.placeholder, `${at}.placeholder`, {
      max: 150,
      plainOnly: true,
    }),
    ...(element.action_id && element.action_id.length > 255
      ? [`${at}.action_id: longer than 255 characters`]
      : []),
  ];

  if (element.type === 'button') {
    problems.push(
      ...textProblems(element.text, `${at}.text`, { max: 75, plainOnly: true }),
    );

    if (element.style && !['primary', 'danger'].includes(element.style)) {
      problems.push(`${at}.style: must be primary or danger`);
    }

    if (element.value && element.value.length > 2000) {
      problems.push(`${at}.value: longer than 2000 characters`);
    }
  }

  if (element.type === 'datepicker' && element.initial_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(element.initial_date)) {
      problems.push(`${at}.initial_date: must be YYYY-MM-DD`);
    }
  }

  if (
    element.type === 'number_input' &&
    typeof element.is_decimal_allowed !== 'boolean'
  ) {
    problems.push(`${at}.is_decimal_allowed: required`);
  }

  if (element.options || element.option_groups || MAX_OPTIONS[element.type]) {
    const options = element.options ?? [];
    const max = MAX_OPTIONS[element.type];

    if (!element.option_groups && !options.length) {
      problems.push(`${at}.options: must not be empty`);
    }

    if (max && options.length > max) {
      problems.push(`${at}.options: more than ${max}`);
    }

    const textType = ['checkboxes', 'radio_buttons'].includes(element.type)
      ? 'any'
      : 'plain';
    options.forEach((option: SlackJson, i: number) =>
      problems.push(...optionProblems(option, `${at}.options[${i}]`, textType)),
    );
    problems.push(...initialOptionProblems(element, at));
  }

  return problems;
};

const BLOCK_FIELDS: Record<string, string[]> = {
  section: ['type', 'block_id', 'text', 'fields', 'accessory', 'expand'],
  actions: ['type', 'block_id', 'elements'],
  divider: ['type', 'block_id'],
  header: ['type', 'block_id', 'text'],
  context: ['type', 'block_id', 'elements'],
  input: [
    'type',
    'block_id',
    'label',
    'element',
    'dispatch_action',
    'hint',
    'optional',
  ],
  image: ['type', 'block_id', 'image_url', 'alt_text', 'title', 'slack_file'],
  // Messages and App Home only, not modals (viewProblems).
  table: ['type', 'block_id', 'rows', 'column_settings'],
};

const tableProblems = (block: SlackJson, at: string): Problems => {
  const problems: Problems = [];
  const rows: SlackJson[][] = block.rows ?? [];
  let characters = 0;

  if (!rows.length || rows.length > 100) {
    problems.push(`${at}.rows: must have 1 to 100 rows`);
  }

  rows.forEach((row, i) => {
    if (!Array.isArray(row) || !row.length || row.length > 20) {
      problems.push(`${at}.rows[${i}]: must have 1 to 20 cells`);

      return;
    }

    row.forEach((cell, j) => {
      const cellAt = `${at}.rows[${i}][${j}]`;

      if (cell.type === 'raw_text') {
        problems.push(...unknownKeys(cell, ['type', 'text'], cellAt));
        characters += String(cell.text ?? '').length;
      } else if (cell.type === 'rich_text') {
        problems.push(...unknownKeys(cell, ['type', 'elements'], cellAt));
        characters += JSON.stringify(cell.elements ?? []).length;
      } else {
        problems.push(`${cellAt}: unknown cell type ${cell.type}`);
      }
    });
  });

  if (characters > 10000) {
    problems.push(`${at}: more than 10000 characters in its cells`);
  }

  ((block.column_settings ?? []) as (SlackJson | null)[]).forEach(
    (setting, i) => {
      if (setting) {
        problems.push(
          ...unknownKeys(
            setting,
            ['align', 'is_wrapped'],
            `${at}.column_settings[${i}]`,
          ),
        );
      }
    },
  );

  return problems;
};

const blockProblems = (block: SlackJson, at: string): Problems => {
  const fields = BLOCK_FIELDS[block.type];

  if (!fields) {
    return [`${at}: unknown block type ${block.type}`];
  }

  const problems = unknownKeys(block, fields, at);

  if (block.block_id && block.block_id.length > 255) {
    problems.push(`${at}.block_id: longer than 255 characters`);
  }

  switch (block.type) {
    case 'section':
      if (!block.text && !block.fields?.length) {
        problems.push(`${at}: needs text or fields`);
      }
      problems.push(...textProblems(block.text, `${at}.text`, { max: 3000 }));
      if ((block.fields ?? []).length > 10) {
        problems.push(`${at}.fields: more than 10`);
      }
      (block.fields ?? []).forEach((field: SlackJson, i: number) =>
        problems.push(
          ...textProblems(field, `${at}.fields[${i}]`, { max: 2000 }),
        ),
      );
      if (block.accessory) {
        problems.push(...elementProblems(block.accessory, `${at}.accessory`));
      }
      break;
    case 'actions':
      if (!block.elements?.length || block.elements.length > 25) {
        problems.push(`${at}.elements: must have 1 to 25 elements`);
      }
      (block.elements ?? []).forEach((element: SlackJson, i: number) =>
        problems.push(...elementProblems(element, `${at}.elements[${i}]`)),
      );
      problems.push(...duplicateActionIds(block.elements ?? [], at));
      break;
    case 'header':
      problems.push(
        ...textProblems(block.text, `${at}.text`, {
          max: 150,
          plainOnly: true,
        }),
      );
      break;
    case 'context':
      if (!block.elements?.length || block.elements.length > 10) {
        problems.push(`${at}.elements: must have 1 to 10 elements`);
      }
      break;
    case 'table':
      problems.push(...tableProblems(block, at));
      break;
    case 'input':
      problems.push(
        ...textProblems(block.label, `${at}.label`, {
          max: 2000,
          plainOnly: true,
        }),
        ...textProblems(block.hint, `${at}.hint`, {
          max: 2000,
          plainOnly: true,
        }),
      );
      if (!block.element) {
        problems.push(`${at}.element: required`);
      } else {
        problems.push(...elementProblems(block.element, `${at}.element`));
      }
      break;
  }

  return problems;
};

const duplicateActionIds = (elements: SlackJson[], at: string) => {
  const ids = elements.map((element) => element.action_id).filter(Boolean);

  return ids
    .filter((id, i) => ids.indexOf(id) !== i)
    .map((id) => `${at}: action_id ${id} is used twice`);
};

const blocksProblems = (
  blocks: SlackJson[] | undefined,
  max: number,
): Problems => {
  if (!blocks) {
    return [];
  }

  const problems =
    blocks.length > max ? [`blocks: more than ${max}`] : ([] as Problems);
  const blockIds = blocks.map((block) => block.block_id).filter(Boolean);

  blockIds
    .filter((id, i) => blockIds.indexOf(id) !== i)
    .forEach((id) => problems.push(`blocks: block_id ${id} is used twice`));
  blocks.forEach((block, i) =>
    problems.push(...blockProblems(block, `blocks[${i}]`)),
  );

  return problems;
};

// `undefined` fields never reach Slack: the JSON body drops them.
const asSent = (value: unknown): SlackJson =>
  JSON.parse(JSON.stringify(value ?? {}));

// Slack documents its limits per table; the app keeps to one table per view
// or message.
const tablesProblems = (blocks: SlackJson[] = []): Problems =>
  blocks.filter((block) => block.type === 'table').length > 1
    ? ['blocks: more than one table']
    : [];

export const viewProblems = (sentView: unknown): Problems => {
  const view = asSent(sentView);

  if (view.type === 'home') {
    return [
      ...unknownKeys(
        view,
        ['type', 'blocks', 'private_metadata', 'callback_id', 'external_id'],
        'view',
      ),
      ...blocksProblems(view.blocks, 100),
      ...tablesProblems(view.blocks),
      ...metadataProblems(view),
    ];
  }

  if (view.type !== 'modal') {
    return [`view.type: must be modal or home, not ${view.type}`];
  }

  const problems = [
    ...unknownKeys(
      view,
      [
        'type',
        'title',
        'blocks',
        'close',
        'submit',
        'private_metadata',
        'callback_id',
        'clear_on_close',
        'notify_on_close',
        'external_id',
        'submit_disabled',
      ],
      'view',
    ),
    ...textProblems(view.title, 'view.title', { max: 24, plainOnly: true }),
    ...textProblems(view.close, 'view.close', { max: 24, plainOnly: true }),
    ...textProblems(view.submit, 'view.submit', { max: 24, plainOnly: true }),
    ...blocksProblems(view.blocks, 100),
    ...metadataProblems(view),
  ];

  if (!view.title) {
    problems.push('view.title: required');
  }

  if ((view.blocks ?? []).some((block) => block.type === 'table')) {
    problems.push('view.blocks: a modal cannot have a table block');
  }

  if (
    !view.submit &&
    (view.blocks ?? []).some((block) => block.type === 'input')
  ) {
    problems.push('view.submit: required when the view has input blocks');
  }

  return problems;
};

const metadataProblems = (view: SlackJson): Problems => [
  ...((view.private_metadata ?? '').length > 3000
    ? ['view.private_metadata: longer than 3000 characters']
    : []),
  ...((view.callback_id ?? '').length > 255
    ? ['view.callback_id: longer than 255 characters']
    : []),
];

export const messageProblems = (message: unknown): Problems => {
  const { blocks, text } = asSent(message);
  const problems = blocksProblems(blocks, 50);

  if (!blocks?.length && !text) {
    problems.push('message: needs text or blocks');
  }

  return problems;
};

// response_action "errors" may only name input blocks of the submitted view.
export const errorsResponseProblems = (
  submittedView: SlackJson,
  errors: Record<string, string>,
): Problems => {
  const inputBlockIds = (submittedView.blocks ?? [])
    .filter((block: SlackJson) => block.type === 'input')
    .map((block: SlackJson) => block.block_id);

  return Object.keys(errors)
    .filter((blockId) => !inputBlockIds.includes(blockId))
    .map((blockId) => `errors: ${blockId} is not an input block of the view`);
};

// The options the app suggests for an external select.
export const suggestionsProblems = (answer: unknown): Problems => {
  const options = asSent(answer).options;

  if (!Array.isArray(options)) {
    return ['options: required'];
  }

  return options.flatMap((option: SlackJson, i: number) =>
    optionProblems(option, `options[${i}]`),
  );
};

// files.getUploadURLExternal: a file needs a name and some bytes (Slack
// answers an empty one with missing_argument).
export const uploadUrlProblems = ({
  filename,
  length,
}: {
  filename?: string;
  length?: number;
}): Problems => [
  ...(filename ? [] : ['filename: required']),
  ...(Number.isInteger(length) && length! > 0
    ? []
    : ['length: the size of the file in bytes, more than 0']),
];

// files.completeUploadExternal: the files must come from
// files.getUploadURLExternal, and the channel is a conversation ID (C…, G…,
// D… or Z…): Slack refuses a user ID there with invalid_arguments.
export const completeUploadProblems = (
  params: unknown,
  uploadedIds: Set<string>,
): Problems => {
  const { files, channel_id: channelId, thread_ts: threadTs } = asSent(params);
  const problems: Problems = [];

  if (!Array.isArray(files) || !files.length) {
    problems.push('files: at least one');
  }

  (Array.isArray(files) ? files : []).forEach((file: SlackJson, i: number) => {
    if (!uploadedIds.has(file.id)) {
      problems.push(`files[${i}].id: not from files.getUploadURLExternal`);
    }

    problems.push(...unknownKeys(file, ['id', 'title'], `files[${i}]`));
  });

  if (channelId !== undefined && !/^[CGDZ][A-Z0-9]+$/.test(channelId)) {
    problems.push(`channel_id: ${channelId} is not a conversation ID`);
  }

  if (threadTs !== undefined && channelId === undefined) {
    problems.push('thread_ts: needs channel_id');
  }

  return problems;
};
