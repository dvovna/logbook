import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';

export interface ILeaveFileUpload {
  id: string;
  slack_team_id: string;
  uploaded_by: string | null;
  kind: LeaveFileKind;
  file_name: string;
  rows: unknown[];
  plan_digest: string;
  status: LeaveFileUploadStatus;
  message_channel: string | null;
  message_ts: string | null;
  undo: unknown | null;
  created_at: string;
  applied_at: string | null;
  undone_at: string | null;
}
