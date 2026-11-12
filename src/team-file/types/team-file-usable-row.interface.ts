import ITeamViewModel from '@modules/teams/types/team.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';

export interface IUsableTeamFileRow {
  row: ITeamFileRow;
  person: IUserViewModel;
  // The existing team the row names, or null for no team or a team to create.
  team: ITeamViewModel | null;
  // Normalized name of the team to create, else ''.
  newKey: string;
  // The team's name as written, repeated spaces collapsed.
  written: string;
  isLead: boolean;
}
