import { csvText, toCsv } from '@common/utils/csv.utils';

describe('csv.utils', () => {
  it('writes rows with CRLF line ends after a UTF-8 byte order mark', () => {
    expect(
      toCsv([
        ['Date', 'Person'],
        ['2026-11-03', 'Анна'],
      ]),
    ).toBe('\uFEFFDate,Person\r\n2026-11-03,Анна\r\n');
  });

  it('quotes fields with commas, quotes and line breaks', () => {
    expect(toCsv([['a,b', 'say "hi"', 'two\nlines', 'plain']])).toBe(
      '\uFEFF"a,b","say ""hi""","two\nlines",plain\r\n',
    );
  });

  it.each([
    ['=HYPERLINK("http://x")', `'=HYPERLINK("http://x")`],
    ['+1', "'+1"],
    ['-cmd', "'-cmd"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tdata', "'\tdata"],
    ['Fixed a=b bug', 'Fixed a=b bug'],
    ['', ''],
  ])('keeps the text %j from running as a formula', (text, safe) => {
    expect(csvText(text)).toBe(safe);
  });

  it('writes nothing for a missing text', () => {
    expect(csvText(null)).toBe('');
    expect(csvText(undefined)).toBe('');
  });
});
