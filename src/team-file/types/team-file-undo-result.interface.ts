import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

// `restored` counts each value put back and each team deleted. `kept`: what Undo left as it is, in words for the person who clicked.
export type ITeamFileUndoResult =
  | {
      kind: 'undone';
      restored: number;
      kept: string[];
      upload: ITeamFileUpload;
    }
  | { kind: 'closed'; reason: string };
