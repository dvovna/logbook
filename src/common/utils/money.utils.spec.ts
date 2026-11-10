import {
  amountInCents,
  formatHourlyRate,
  formatMoney,
  isCurrencyCode,
  isValidHourlyRate,
} from 'src/common/utils/money.utils';

describe('money utils', () => {
  it('knows ISO 4217 codes, in capitals', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('eur')).toBe(false);
    expect(isCurrencyCode('ABC')).toBe(false);
  });

  it('takes rates from 0 with at most two decimals', () => {
    expect(isValidHourlyRate(0)).toBe(true);
    expect(isValidHourlyRate(120.5)).toBe(true);
    expect(isValidHourlyRate(0.29)).toBe(true);
    expect(isValidHourlyRate(1_000_000)).toBe(true);
    expect(isValidHourlyRate(-1)).toBe(false);
    expect(isValidHourlyRate(12.345)).toBe(false);
    expect(isValidHourlyRate(1_000_000.01)).toBe(false);
    expect(isValidHourlyRate(Number.NaN)).toBe(false);
  });

  it('prices minutes in whole cents', () => {
    expect(amountInCents(90, 120.5)).toBe(18075);
    // 20 minutes at 100.01: 33.3366… → 33.34.
    expect(amountInCents(20, 100.01)).toBe(3334);
    // 0.29 is 0.28999… as a float; the cents are still 29.
    expect(amountInCents(60, 0.29)).toBe(29);
  });

  it('writes amounts and rates with the currency sign', () => {
    expect(formatMoney(2502500, 'USD')).toBe('$25,025.00');
    expect(formatMoney(33075, 'EUR')).toBe('€330.75');
    // A code without a sign is kept with its amount by a no-break space.
    expect(formatMoney(1200, 'PLN')).toBe('PLN\u00a012.00');
    expect(formatHourlyRate(95.5, 'GBP')).toBe('£95.50/h');
  });
});
