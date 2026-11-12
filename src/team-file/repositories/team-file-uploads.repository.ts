import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { ITeamFileUndo } from 'src/team-file/types/team-file-undo.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

@Injectable()
export class TeamFileUploadsRepository extends BaseRepository<
  'team_file_uploads',
  ITeamFileUpload
> {
  protected readonly tableName = 'team_file_uploads';

  protected mapToViewModel = (row: SqlRow<'team_file_uploads'>) => ({
    id: row.id,
    slack_team_id: row.slack_team_id,
    uploaded_by: row.uploaded_by,
    file_name: row.file_name,
    rows: row.rows as unknown as ITeamFileRow[],
    plan_digest: row.plan_digest,
    status: row.status as TeamFileUploadStatus,
    message_channel: row.message_channel,
    message_ts: row.message_ts,
    undo: row.undo as unknown as ITeamFileUndo | null,
    created_at: row.created_at,
    applied_at: row.applied_at,
    undone_at: row.undone_at,
  });

  public async supersedePreviewed(slackTeamId: string) {
    await this.updateMany(
      { slack_team_id: slackTeamId, status: TeamFileUploadStatus.Previewed },
      { status: TeamFileUploadStatus.Superseded },
    );
  }

  // One conditional update, so a stale click or an ID from another workspace
  // changes nothing: null when no open preview of the workspace has the ID.
  public async cancelPreviewed(id: string, slackTeamId: string) {
    const [upload] = await this.updateMany(
      {
        id,
        slack_team_id: slackTeamId,
        status: TeamFileUploadStatus.Previewed,
      },
      { status: TeamFileUploadStatus.Canceled },
    );

    return upload ?? null;
  }

  public async setMessage(
    id: string,
    slackTeamId: string,
    channel: string,
    ts: string,
  ) {
    await this.update(
      { id, slack_team_id: slackTeamId },
      { message_channel: channel, message_ts: ts },
    );
  }

  public async setDigest(id: string, slackTeamId: string, digest: string) {
    await this.update(
      { id, slack_team_id: slackTeamId },
      { plan_digest: digest },
    );
  }

  public markApplied(id: string, slackTeamId: string, undo: ITeamFileUndo) {
    return this.update(
      {
        id,
        slack_team_id: slackTeamId,
        status: TeamFileUploadStatus.Previewed,
      },
      {
        status: TeamFileUploadStatus.Applied,
        applied_at: new Date().toISOString(),
        undo: JSON.stringify(undo),
      },
    );
  }

  // The workspace's upload that Undo may work on: the applied one applied last.
  public async findLatestApplied(slackTeamId: string) {
    const row = await this.selectInWorkspace(slackTeamId)
      .selectAll()
      .where('status', '=', TeamFileUploadStatus.Applied)
      .orderBy('applied_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row ? this.toViewModel(row) : null;
  }

  public markUndone(id: string, slackTeamId: string) {
    return this.update(
      {
        id,
        slack_team_id: slackTeamId,
        status: TeamFileUploadStatus.Applied,
      },
      {
        status: TeamFileUploadStatus.Undone,
        undone_at: new Date().toISOString(),
      },
    );
  }
}
