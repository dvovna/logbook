import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

// `kept`: what Undo left as it is, in words for the person who clicked.
export type ITeamFileUndoResult =
  | {
      kind: 'undone';
      restored: number;
      kept: string[];
      deletedTeams: string[];
      upload: ITeamFileUpload;
    }
  | { kind: 'closed'; reason: string };
