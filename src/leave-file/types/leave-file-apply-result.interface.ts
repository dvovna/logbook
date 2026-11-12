import { IUserViewModel } from '@modules/users/types/user.interface';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { ILeaveBalancesPlan } from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';
import { ILeaveHistoryPlan } from 'src/leave-file/types/leave-history-plan.interface';

// `people` are the workspace's, inactive ones included, as the plan was made
// against them: the preview names them.
export type ILeaveFilePreview =
  | {
      kind: LeaveFileKind.Balances;
      plan: ILeaveBalancesPlan;
      people: IUserViewModel[];
    }
  | {
      kind: LeaveFileKind.History;
      plan: ILeaveHistoryPlan;
      people: IUserViewModel[];
    };

export type ILeaveFileApplyResult =
  | {
      // changed: the plan is not the clicked preview's, and is shown instead.
      // nothing: it is, and it changes nothing, so nothing was applied.
      kind: 'applied' | 'changed' | 'nothing';
      preview: ILeaveFilePreview;
      upload: ILeaveFileUpload;
    }
  | {
      kind: 'closed';
      // 'expired': still a preview, but older than Apply allows.
      status: LeaveFileUploadStatus | 'expired';
      upload: ILeaveFileUpload;
    };
