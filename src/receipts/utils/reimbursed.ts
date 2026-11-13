export const toReimburseCents = (
  acceptedCents: number,
  limitCents: number | null,
): number =>
  limitCents === null ? acceptedCents : Math.min(acceptedCents, limitCents);
