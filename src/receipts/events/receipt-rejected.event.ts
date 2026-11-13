export const RECEIPT_REJECTED = 'receipt.rejected';

export class ReceiptRejectedEvent {
  public constructor(
    public readonly receiptId: string,
    public readonly slackTeamId: string,
  ) {}
}
