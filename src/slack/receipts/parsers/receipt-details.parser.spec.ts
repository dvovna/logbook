import { parseAmount } from '@modules/slack/receipts/parsers/receipt-details.parser';

describe('parseAmount', () => {
  it('reads a comma or a point as the decimal separator', () => {
    expect(parseAmount('45,50')).toBe(4550);
    expect(parseAmount('45.5')).toBe(4550);
    expect(parseAmount(' 45 ')).toBe(4500);
  });

  it('ignores spaces between thousands', () => {
    expect(parseAmount('1 000,00')).toBe(100000);
  });

  it('refuses what is not an amount above zero within the limit', () => {
    expect(parseAmount('€45')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('45.555')).toBeNull();
    expect(parseAmount('1000000.01')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('takes the limit itself', () => {
    expect(parseAmount('1000000')).toBe(100_000_000);
  });
});
