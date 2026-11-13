import { toReimburseCents } from '@modules/receipts/utils/reimbursed';

describe('toReimburseCents', () => {
  it('caps the accepted amount at the limit', () => {
    expect(toReimburseCents(6000, 5000)).toBe(5000);
    expect(toReimburseCents(4500, 5000)).toBe(4500);
  });

  it('takes it all without a limit', () => {
    expect(toReimburseCents(6000, null)).toBe(6000);
  });
});
