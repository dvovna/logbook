// Starts the requests of a workspace that wait for anyone who can approve
// them (VacationRequestProcessingService).
export const START_WAITING_JOB = 'vacation-request-start-waiting';

export interface IStartWaitingJob {
  slackTeamId: string;
  // Only this one: the look again after its approval found nobody.
  requestId?: string;
}
