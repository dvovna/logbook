import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
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
    undo: row.undo,
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
}
