// The job that sends a billing snapshot's CSV to the person who asked.
export interface IBillingSnapshotCsvJob {
  slackTeamId: string;
  userId: string;
  snapshotId: string;
}
