import {
  parseDecisionValue,
  toDecisionValue,
} from '@modules/slack/tabs/receipts/utils/receipt-decision-value';

const ID = '0b7c2d8e-4f1a-4c3b-9e2d-6a5f4e3d2c1b';

describe('receipt decision values', () => {
  it('carries the receipt and the moment it was sent, to the millisecond', () => {
    const value = toDecisionValue({
      id: ID,
      submittedAt: '2026-06-17T08:00:00.123456+00:00',
    });

    expect(value).toBe(`${ID}.1781683200123`);
    expect(parseDecisionValue(value)).toEqual({
      receiptId: ID,
      expected: { submittedAt: '2026-06-17T08:00:00.123Z' },
    });
  });

  it('fits a menu option’s 75 characters with the longest action', () => {
    const value = toDecisionValue({
      id: ID,
      submittedAt: '2026-06-17T08:00:00.000Z',
    });

    expect(`reject_receipt:${value}`.length).toBeLessThanOrEqual(75);
  });

  it('expects nothing of a value without the moment, as views published before had', () => {
    expect(parseDecisionValue(ID)).toEqual({ receiptId: ID });
    expect(parseDecisionValue(`${ID}.soon`)).toEqual({ receiptId: ID });
    expect(toDecisionValue({ id: ID, submittedAt: null })).toBe(ID);
  });
});
