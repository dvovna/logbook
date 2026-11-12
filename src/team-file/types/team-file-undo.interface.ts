import UserRole from '@common/enums/user-role.enum';

// What Apply changed, value by value, for Undo: it puts `before` back where
// the value is still `after`.
export interface ITeamFileUndo {
  createdTeamIds: string[];
  assignments: {
    userId: string;
    before: string | null;
    after: string | null;
  }[];
  // Slack IDs, as teams.manager_approvers holds them.
  approvers: { teamId: string; before: string[]; after: string[] }[];
  promotions: { userId: string; before: UserRole }[];
}
