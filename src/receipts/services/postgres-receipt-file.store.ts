import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';

// The only code that names receipt_files, so that no query of receipts reads
// the bytes.
@Injectable()
export class PostgresReceiptFileStore extends ReceiptFileStore {
  public constructor(private readonly database: DatabaseService) {
    super();
  }

  public async put(
    receiptId: string,
    slackTeamId: string,
    content: Buffer,
  ): Promise<void> {
    await this.database.db
      .insertInto('receipt_files')
      .values({
        receipt_id: receiptId,
        slack_team_id: slackTeamId,
        // pg sends a Buffer as bytea; the generated type says string.
        content: content as unknown as string,
      })
      .execute();
  }

  public async get(
    receiptId: string,
    slackTeamId: string,
  ): Promise<Buffer | null> {
    const row = await this.database.db
      .selectFrom('receipt_files')
      .select('content')
      .where('receipt_id', '=', receiptId)
      .where('slack_team_id', '=', slackTeamId)
      .executeTakeFirst();

    return row ? (row.content as unknown as Buffer) : null;
  }

  public async delete(
    receiptIds: string[],
    slackTeamId: string,
  ): Promise<void> {
    if (receiptIds.length === 0) {
      return;
    }

    await this.database.db
      .deleteFrom('receipt_files')
      .where('slack_team_id', '=', slackTeamId)
      .where('receipt_id', '=', (eb) => eb.fn.any(eb.val(receiptIds)))
      .execute();
  }
}
