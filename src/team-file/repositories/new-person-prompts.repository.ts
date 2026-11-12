import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { INewPersonPrompt } from 'src/team-file/types/new-person-prompt.interface';

@Injectable()
export class NewPersonPromptsRepository extends BaseRepository<
  'new_person_prompts',
  INewPersonPrompt
> {
  protected readonly tableName = 'new_person_prompts';

  protected mapToViewModel = (row: SqlRow<'new_person_prompts'>) => ({
    id: row.id,
    slack_team_id: row.slack_team_id,
    user_id: row.user_id,
    recipient_slack_id: row.recipient_slack_id,
    channel: row.channel,
    ts: row.ts,
    closed_at: row.closed_at,
    created_at: row.created_at,
  });

  // The unique (person, recipient) keeps a repeated job from saving a
  // second question for the same recipient.
  public async save(prompt: {
    slackTeamId: string;
    userId: string;
    recipientSlackId: string;
    channel: string;
    ts: string;
  }) {
    await this.db
      .insertInto('new_person_prompts')
      .values({
        slack_team_id: prompt.slackTeamId,
        user_id: prompt.userId,
        recipient_slack_id: prompt.recipientSlackId,
        channel: prompt.channel,
        ts: prompt.ts,
      })
      .onConflict((conflict) =>
        conflict.columns(['user_id', 'recipient_slack_id']).doNothing(),
      )
      .execute();
  }

  // One conditional update, so two events for the same person close each
  // question once: it returns only the questions this call closed.
  public closeOpen(userId: string, slackTeamId: string) {
    return this.updateMany(
      { slack_team_id: slackTeamId, user_id: userId, closed_at: null },
      { closed_at: new Date().toISOString() },
    );
  }
}
