import { z } from 'zod';
import { MAX_HOURLY_RATE } from '@common/utils/money.utils';

// An hourly rate as typed in a number input: empty for none (null), else 0
// or more with at most two decimals, as the database keeps it.
export const hourlyRateSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
    'Enter the rate as a number, such as 120 or 95.50',
  )
  .transform((value) => (value === '' ? null : Number(value)))
  .refine(
    (rate) => rate === null || rate <= MAX_HOURLY_RATE,
    `The rate must be at most ${MAX_HOURLY_RATE}`,
  );

// The number input of a rate, in the workspace's currency. Empty clears it.
export const hourlyRateElement = (actionId: string, rate?: number | null) => ({
  type: 'number_input',
  action_id: actionId,
  is_decimal_allowed: true,
  min_value: '0',
  max_value: String(MAX_HOURLY_RATE),
  ...(rate !== null && rate !== undefined
    ? { initial_value: rate.toFixed(2) }
    : {}),
});
