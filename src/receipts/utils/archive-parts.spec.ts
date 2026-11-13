import { splitIntoParts } from '@modules/receipts/utils/archive-parts';

const f = (sizeBytes: number) => ({ sizeBytes });

describe('splitIntoParts', () => {
  it('starts a new part when the next file would not fit', () => {
    expect(splitIntoParts([f(8), f(8), f(8)], 20)).toEqual([
      [f(8), f(8)],
      [f(8)],
    ]);
  });

  it('puts a file bigger than the limit alone in its part', () => {
    expect(splitIntoParts([f(30), f(5)], 20)).toEqual([[f(30)], [f(5)]]);
    expect(splitIntoParts([f(5), f(30), f(5)], 20)).toEqual([
      [f(5)],
      [f(30)],
      [f(5)],
    ]);
  });

  it('keeps the order and fills a part up to the limit', () => {
    expect(splitIntoParts([f(10), f(10), f(1)], 20)).toEqual([
      [f(10), f(10)],
      [f(1)],
    ]);
  });

  it('gives one empty part for no files', () => {
    expect(splitIntoParts([], 20)).toEqual([[]]);
  });
});
