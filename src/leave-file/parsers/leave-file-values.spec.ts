import {
  parseDays,
  parseFileDate,
  slashOrderOf,
  SlashOrder,
} from 'src/leave-file/parsers/leave-file-values';

describe('leave file values', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['12', { kind: 'days', value: 12 }],
    ['12.5', { kind: 'days', value: 12.5 }],
    ['12,5', { kind: 'days', value: 12.5 }],
    ['-2', { kind: 'days', value: -2 }],
    ['12.3', { kind: 'not-half' }],
    ['twelve', { kind: 'invalid' }],
    ['1 2', { kind: 'invalid' }],
  ])('parseDays(%p)', (text, expected) =>
    expect(parseDays(text)).toEqual(expected),
  );

  it.each([
    [['15/04/2021', '11/12/2026'], 'dmy'],
    [['4/15/2021', '11/12/2026'], 'mdy'],
    [['15/04/2021', '4/15/2021'], 'inconsistent'],
    [['5/4/2026', '11/12/2026'], 'ambiguous'],
    [['2026-11-12', '12.11.2026'], 'none'],
  ])('slashOrderOf(%p)', (texts, expected) =>
    expect(slashOrderOf(texts)).toBe(expected),
  );

  it.each([
    ['2026-05-04', 'none', '2026-05-04'],
    ['2026-05-04T00:00:00.000Z', 'none', '2026-05-04'],
    ['4.5.2026', 'none', '2026-05-04'],
    ['04/05/2026', 'dmy', '2026-05-04'],
    ['05/04/2026', 'mdy', '2026-05-04'],
    ['5/4/26', 'mdy', '2026-05-04'],
    ['29.02.2028', 'none', '2028-02-29'],
  ])('parseFileDate(%p, %p)', (text, order, value) =>
    expect(parseFileDate(text, order as SlashOrder)).toEqual({
      kind: 'date',
      value,
    }),
  );

  it.each([
    ['31.02.2026', 'none', 'invalid'],
    ['2026-13-01', 'none', 'invalid'],
    ['soon', 'none', 'invalid'],
    ['05/04/2026', 'ambiguous', 'ambiguous'],
    ['05/04/2026', 'inconsistent', 'inconsistent'],
    ['05/04/2026', 'none', 'ambiguous'],
  ])('parseFileDate(%p, %p) is %p', (text, order, kind) =>
    expect(parseFileDate(text, order as SlashOrder)).toEqual({ kind }),
  );

  it('treats an empty text as an empty date', () => {
    expect(parseFileDate('  ', 'none')).toEqual({ kind: 'empty' });
  });
});
