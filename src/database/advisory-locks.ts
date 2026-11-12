export interface IAdvisoryLock {
  key: string;
  rank: number;
}

// A transaction takes the locks it needs in rank order, lowest first, and
// locks of one rank by key (TransactionService.lock refuses any other
// order): two transactions that each hold one lock and wait for the other's
// would never finish. A request
// is changed under its own lock, then its approval workflow under the
// workflow's; logging time off as time and a timesheet save both take the
// person's time last. The workspace locks are taken alone.
const RANK = {
  vacationRequest: 10,
  workflow: 20,
  timesheet: 30,
  clients: 40,
  billingSnapshots: 50,
  teamFile: 60,
  singletonJob: 70,
  slackToken: 80,
} as const;

export const compareLocks = (a: IAdvisoryLock, b: IAdvisoryLock) =>
  a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export const vacationRequestLock = (requestId: string): IAdvisoryLock => ({
  key: `vacation-request:${requestId}`,
  rank: RANK.vacationRequest,
});

export const workflowLock = (requestId: string): IAdvisoryLock => ({
  key: `workflow:${requestId}`,
  rank: RANK.workflow,
});

export const timesheetLock = (userId: string): IAdvisoryLock => ({
  key: `timesheet:${userId}`,
  rank: RANK.timesheet,
});

export const clientsLock = (slackTeamId: string): IAdvisoryLock => ({
  key: `clients:${slackTeamId}`,
  rank: RANK.clients,
});

export const billingSnapshotsLock = (slackTeamId: string): IAdvisoryLock => ({
  key: `billing-snapshots:${slackTeamId}`,
  rank: RANK.billingSnapshots,
});

// A team file's preview, Apply and Undo: one at a time per workspace.
export const teamFileLock = (slackTeamId: string): IAdvisoryLock => ({
  key: `team-file:${slackTeamId}`,
  rank: RANK.teamFile,
});

// The check that no job of a name and key is pending, and the save after
// it (JobsService.enqueueSingleton).
export const singletonJobLock = (
  name: string,
  singletonKey: string,
): IAdvisoryLock => ({
  key: `job:${name}:${singletonKey}`,
  rank: RANK.singletonJob,
});

// A workspace's bot token refresh: one at a time across processes, since
// Slack takes a refresh token once (AccessTokenService). Taken alone.
export const slackTokenLock = (slackTeamId: string): IAdvisoryLock => ({
  key: `slack-token:${slackTeamId}`,
  rank: RANK.slackToken,
});
