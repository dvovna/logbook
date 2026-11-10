export enum RequestWorkflowStatus {
  Approved = 'approved',
  Rejected = 'rejected',
  Canceled = 'canceled',
  // The request was deleted; its steps go with it right after.
  Deleted = 'deleted',
}
