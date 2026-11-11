import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

// 'expired': still a preview, but older than Apply allows.
export type ITeamFileClosedStatus = TeamFileUploadStatus | 'expired';

// `state` is the workspace the plan was made against, before Apply.
export type ITeamFileApplyResult =
  | {
      kind: 'applied';
      plan: ITeamFilePlan;
      state: ITeamFileState;
      upload: ITeamFileUpload;
    }
  | {
      kind: 'changed';
      plan: ITeamFilePlan;
      state: ITeamFileState;
      upload: ITeamFileUpload;
    }
  | {
      kind: 'closed';
      status: ITeamFileClosedStatus;
      upload: ITeamFileUpload;
    };
