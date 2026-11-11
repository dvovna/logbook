import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';

export interface ITeamFileUpload {
  id: string;
  slack_team_id: string;
  uploaded_by: string | null;
  file_name: string;
  rows: ITeamFileRow[];
  plan_digest: string;
  status: TeamFileUploadStatus;
  message_channel: string | null;
  message_ts: string | null;
  undo: unknown;
  created_at: string;
  applied_at: string | null;
  undone_at: string | null;
}
