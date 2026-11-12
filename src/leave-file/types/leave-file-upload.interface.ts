import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import {
  ILeaveBalanceRow,
  ILeaveHistoryRow,
} from 'src/leave-file/types/leave-file-row.interface';
import { ILeaveFileUndo } from 'src/leave-file/types/leave-file-undo.interface';

export interface ILeaveFileUpload {
  id: string;
  slack_team_id: string;
  uploaded_by: string | null;
  kind: LeaveFileKind;
  file_name: string;
  // The file's rows, of its kind.
  rows: ILeaveBalanceRow[] | ILeaveHistoryRow[];
  plan_digest: string;
  status: LeaveFileUploadStatus;
  message_channel: string | null;
  message_ts: string | null;
  undo: ILeaveFileUndo | null;
  created_at: string;
  applied_at: string | null;
  undone_at: string | null;
}
