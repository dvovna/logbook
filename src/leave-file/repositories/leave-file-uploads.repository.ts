import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';

@Injectable()
export class LeaveFileUploadsRepository extends BaseRepository<
  'leave_file_uploads',
  ILeaveFileUpload
> {
  protected readonly tableName = 'leave_file_uploads';

  protected mapToViewModel = (row: SqlRow<'leave_file_uploads'>) => ({
    id: row.id,
    slack_team_id: row.slack_team_id,
    uploaded_by: row.uploaded_by,
    kind: row.kind as LeaveFileKind,
    file_name: row.file_name,
    rows: row.rows as unknown as unknown[],
    plan_digest: row.plan_digest,
    status: row.status as LeaveFileUploadStatus,
    message_channel: row.message_channel,
    message_ts: row.message_ts,
    undo: row.undo as unknown,
    created_at: row.created_at,
    applied_at: row.applied_at,
    undone_at: row.undone_at,
  });

  public async supersedePreviewed(slackTeamId: string, kind: LeaveFileKind) {
    await this.updateMany(
      {
        slack_team_id: slackTeamId,
        kind,
        status: LeaveFileUploadStatus.Previewed,
      },
      { status: LeaveFileUploadStatus.Superseded },
    );
  }

  // One conditional update, so a stale click or an ID from another workspace
  // changes nothing: null when no open preview of the workspace has the ID.
  public async cancelPreviewed(id: string, slackTeamId: string) {
    const [upload] = await this.updateMany(
      {
        id,
        slack_team_id: slackTeamId,
        status: LeaveFileUploadStatus.Previewed,
      },
      { status: LeaveFileUploadStatus.Canceled },
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

  public markApplied(id: string, slackTeamId: string, undo: unknown) {
    return this.update(
      {
        id,
        slack_team_id: slackTeamId,
        status: LeaveFileUploadStatus.Previewed,
      },
      {
        status: LeaveFileUploadStatus.Applied,
        applied_at: new Date().toISOString(),
        undo: JSON.stringify(undo),
      },
    );
  }

  public markUndone(id: string, slackTeamId: string) {
    return this.update(
      {
        id,
        slack_team_id: slackTeamId,
        status: LeaveFileUploadStatus.Applied,
      },
      {
        status: LeaveFileUploadStatus.Undone,
        undone_at: new Date().toISOString(),
      },
    );
  }

  public async hasApplied(slackTeamId: string) {
    const row = await this.selectInWorkspace(slackTeamId)
      .select('id')
      .where('status', '=', LeaveFileUploadStatus.Applied)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }
}
