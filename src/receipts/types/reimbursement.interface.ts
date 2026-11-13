export interface IReimbursementViewModel {
  id: string;
  slackTeamId: string;
  name: string;
  dueDay: number;
  limitCents: number | null;
  archivedAt: string | null;
  createdAt: string;
}
