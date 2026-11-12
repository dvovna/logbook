import { IStoredBalance } from '@modules/vacation-requests/utils/leave-balance.utils';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';

// What Apply changed, for Undo: it puts back only what is still as Apply
// left it, which `updatedAt` and `after` tell.
export type ILeaveFileUndo =
  | {
      kind: LeaveFileKind.History;
      requests: { id: string; updatedAt: string }[];
    }
  | {
      kind: LeaveFileKind.Balances;
      // `before` is the earlier row whole, or null when there was none.
      balances: {
        userId: string;
        before: IStoredBalance | null;
        updatedAt: string;
      }[];
      contractStarts: {
        userId: string;
        before: string | null;
        after: string;
      }[];
    };
