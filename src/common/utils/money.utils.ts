// Money in the workspace's currency (slack_teams.currency). Rates are numbers
// with at most two decimals, as numeric(10, 2) keeps them; amounts are whole
// cents, so that sums of amounts don't drift.

// What numeric(10, 2) holds, in round numbers.
export const MAX_HOURLY_RATE = 1_000_000;

// The ISO 4217 codes this Node knows, e.g. USD, EUR, GBP. The target library
// (ES2021) has no type for Intl.supportedValuesOf yet.
const CURRENCY_CODES = new Set(
  (
    Intl as unknown as { supportedValuesOf(key: 'currency'): string[] }
  ).supportedValuesOf('currency'),
);

export const isCurrencyCode = (code: string) => CURRENCY_CODES.has(code);

export const toCents = (amount: number) => Math.round(amount * 100);

// 0 or more, at most MAX_HOURLY_RATE, at most two decimals.
export const isValidHourlyRate = (rate: number) =>
  Number.isFinite(rate) &&
  rate >= 0 &&
  rate <= MAX_HOURLY_RATE &&
  Math.abs(rate * 100 - toCents(rate)) < 1e-6;

// `minutes` of work at `hourlyRate`, in cents.
export const amountInCents = (minutes: number, hourlyRate: number) =>
  Math.round((toCents(hourlyRate) * minutes) / 60);

// "$1,234.50", "€90.00", "PLN 12.00": with the currency's sign where English
// has one, and its usual decimals.
export const formatMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    cents / 100,
  );

// "$120.00/h".
export const formatHourlyRate = (hourlyRate: number, currency: string) =>
  `${formatMoney(toCents(hourlyRate), currency)}/h`;
