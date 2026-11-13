// Where the bytes of receipts are kept. Postgres today; the services know
// only this, so another place (object storage) can replace it.
export abstract class ReceiptFileStore {
  public abstract put(
    receiptId: string,
    slackTeamId: string,
    content: Buffer,
  ): Promise<void>;

  public abstract get(
    receiptId: string,
    slackTeamId: string,
  ): Promise<Buffer | null>;

  public abstract delete(
    receiptIds: string[],
    slackTeamId: string,
  ): Promise<void>;
}
