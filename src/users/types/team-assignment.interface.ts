export interface ITeamAssignment {
  userId: string;
  // null takes the user out of any team.
  teamId: string | null;
}
