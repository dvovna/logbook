import {
  messageDisplayProblems,
  viewDisplayProblems,
} from './support/block-kit-display-rules';

const button = (text: string) => ({
  type: 'button',
  text: { type: 'plain_text', text },
  action_id: text,
});
const home = (...blocks: unknown[]) => ({ type: 'home', blocks });
const mrkdwn = (text: string) => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

// The rules only fail tests when they fire, so a rule that never fires
// would pass unnoticed: each one is checked here on its own.
describe('What Slack takes but shows wrongly', () => {
  it('finds a row of more than five buttons, which Slack folds', () => {
    const row = (count: number) => ({
      type: 'actions',
      elements: Array.from({ length: count }, (_, i) => button(`b${i}`)),
    });

    expect(viewDisplayProblems(home(row(5)))).toEqual([]);
    expect(viewDisplayProblems(home(row(7)))).toEqual([
      'blocks[0]: Slack shows 5 of its 7 elements and folds the rest into "+ 2 more"',
    ]);
  });

  it('finds a ⋯ menu with one option', () => {
    const menu = (...labels: string[]) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Acme' },
      accessory: {
        type: 'overflow',
        action_id: 'menu',
        options: labels.map((label) => ({
          text: { type: 'plain_text', text: label },
          value: label,
        })),
      },
    });

    expect(viewDisplayProblems(home(menu('Edit', 'Delete')))).toEqual([]);
    expect(viewDisplayProblems(home(menu('Restore')))).toEqual([
      'blocks[0].accessory: an overflow menu with one option (Restore): make it a button',
    ]);
  });

  it('finds two dividers in a row', () => {
    const divider = { type: 'divider' };

    expect(viewDisplayProblems(home(divider, mrkdwn('a'), divider))).toEqual(
      [],
    );
    expect(viewDisplayProblems(home(mrkdwn('a'), divider, divider))).toEqual([
      'blocks[1]: two dividers in a row',
    ]);
  });

  it('finds Markdown that mrkdwn shows as typed', () => {
    expect(
      viewDisplayProblems(
        home(mrkdwn('*Bold* and _italic_, <https://example.com|a link>')),
      ),
    ).toEqual([]);
    expect(
      viewDisplayProblems(
        home(mrkdwn('**Bold**, [a link](https://example.com)')),
      ),
    ).toEqual([
      'blocks[0].text: mrkdwn shows **bold** (mrkdwn bold is *bold*) as typed: "**Bold**, [a link](https://example.com)"',
      'blocks[0].text: mrkdwn shows [label](url) (a mrkdwn link is <url|label>) as typed: "**Bold**, [a link](https://example.com)"',
    ]);
  });

  it('finds formatting in plain_text, also in titles and messages', () => {
    expect(
      viewDisplayProblems({
        type: 'modal',
        title: { type: 'plain_text', text: '*Edit* client' },
        blocks: [{ type: 'actions', elements: [button('2 * 3 = 6')] }],
      }),
    ).toEqual([
      'view.title: plain_text shows *bold* as typed: "*Edit* client"',
    ]);
    expect(messageDisplayProblems({ text: 'Approved by **Ada**' })).toEqual([
      'text: mrkdwn shows **bold** (mrkdwn bold is *bold*) as typed: "Approved by **Ada**"',
    ]);
  });
});
