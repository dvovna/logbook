import { IUserViewModel } from '@modules/users/types/user.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';

export interface ITeamFileState {
  people: IUserViewModel[];
  teams: ITeamViewModel[];
}

export interface ITeamFilePlan {
  createTeams: {
    key: string;
    name: string;
    leadIds: string[];
    memberIds: string[];
  }[];
  assignments: {
    userId: string;
    fromTeamId: string | null;
    toTeamId: string | null;
    toTeamKey: string | null;
  }[];
  leadChanges: { teamId: string; add: string[]; remove: string[] }[];
  promotions: string[];
  nameMatches: { written: string; teamName: string }[];
  teamsWithoutLead: string[];
  leftWithoutTeam: string[];
  unusable: { row: number; reason: string }[];
}
