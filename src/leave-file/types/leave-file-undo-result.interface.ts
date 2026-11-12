import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';

// `restored` counts each leave deleted and each balance and contract start
// put back. `kept`: what Undo left as it is, in words for the person who
// clicked.
export type ILeaveFileUndoResult =
  | {
      kind: 'undone';
      restored: number;
      kept: string[];
      upload: ILeaveFileUpload;
    }
  | { kind: 'closed'; reason: string };
