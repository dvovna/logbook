import {
  fullList,
  messageBlocks,
  section,
} from '@modules/slack/common/views/components/message-sections';

const textsOf = (blocks: unknown[]) =>
  (blocks as { text: { text: string } }[]).map(({ text }) => text.text);

// `count` bullets of `length` characters each, "• " included.
const items = (count: number, length: number) =>
  Array.from({ length: count }, (_, i) => `${i}`.padEnd(length - 2, 'x'));

describe('messageBlocks', () => {
  it('puts a short list in one section under its title', () =>
    expect(textsOf(messageBlocks([fullList('*Title*', ['a', 'b'])]))).toEqual([
      '*Title*\n• a\n• b',
    ]));

  it('goes on in the next sections, each at most 3000 characters', () => {
    const texts = textsOf(
      messageBlocks([fullList('*Title*', items(30, 299), 'Intro')]),
    );

    expect(texts.map((text) => text.length)).toEqual([2713, 2999, 2999, 299]);
    expect(texts[0].split('\n').slice(0, 2)).toEqual(['*Title*', 'Intro']);
    expect(texts.join('\n').match(/^• /gm)).toHaveLength(30);
  });

  it('shares the blocks the other parts leave, one at least for each list after', () => {
    const fixed = Array.from({ length: 46 }, () => section('-'));
    const blocks = messageBlocks([
      fullList('*First*', items(100, 300)),
      ...fixed,
      fullList('*Second*', items(100, 300)),
    ]);
    const texts = textsOf(blocks);

    expect(blocks).toHaveLength(50);
    expect(texts[0]).toMatch(/^\*First\*\n/);
    expect(texts[2]).toMatch(/\n…and 73 more$/);
    expect(texts[49]).toMatch(/^\*Second\*\n[^]*\n…and 91 more$/);
  });

  it('lets the last line use the room kept for counting what is left out', () => {
    // The title and 10 lines of 296 make 2973 characters.
    const texts = textsOf(
      messageBlocks([
        ...Array.from({ length: 49 }, () => section('-')),
        fullList('*T*', items(10, 296)),
      ]),
    );

    expect(texts[49]).toHaveLength(2973);
    expect(texts[49]).not.toContain('…and');
  });

  it('cuts a line longer than a section', () => {
    const [text] = textsOf(
      messageBlocks([fullList('*T*', ['y'.repeat(5000)])]),
    );

    expect(text).toHaveLength(2974);
    expect(text.endsWith('y…')).toBe(true);
  });
});
