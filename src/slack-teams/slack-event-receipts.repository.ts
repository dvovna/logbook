import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';

export interface ISlackEventReceipt {
  slack_team_id: string;
  event_id: string;
  received_at: string;
}

export interface IEventDelivery {
  // The workspace has a slack_teams row.
  known: boolean;
  // This delivery left the event's receipt: no other did before it.
  first: boolean;
}

@Injectable()
export class SlackEventReceiptsRepository extends BaseRepository<
  'slack_event_receipts',
  ISlackEventReceipt
> {
  protected readonly tableName = 'slack_event_receipts';

  protected mapToViewModel = (row: SqlRow<'slack_event_receipts'>) => ({
    slack_team_id: row.slack_team_id,
    event_id: row.event_id,
    received_at: row.received_at,
  });

  // Leaves the event's receipt in the workspace that `workspaceSlackId`
  // names, in one statement: an event comes before the app knows the
  // workspace's ID, and Slack waits 3 seconds for the answer. A second
  // delivery at the same time waits for the first one's transaction, and
  // finds its receipt once that commits.
  public async receive(
    workspaceSlackId: string,
    eventId: string,
    receivedAt: string,
  ): Promise<IEventDelivery> {
    const { rows } = await sql<IEventDelivery>`
      with workspace as (
        select id from slack_teams where slack_id = ${workspaceSlackId}
      ),
      receipt as (
        insert into slack_event_receipts (slack_team_id, event_id, received_at)
        select id, ${eventId}::text, ${receivedAt}::timestamptz from workspace
        on conflict do nothing
        returning event_id
      )
      select exists (select from workspace) as known,
        exists (select from receipt) as first
    `.execute(this.db);

    return rows[0];
  }

  // Every workspace's receipts from before `cutoff`: they are kept alike.
  public async deleteReceivedBefore(cutoff: string): Promise<number> {
    const result = await this.db
      .deleteFrom('slack_event_receipts')
      .where('received_at', '<', cutoff)
      .executeTakeFirstOrThrow();

    return Number(result.numDeletedRows);
  }
}
