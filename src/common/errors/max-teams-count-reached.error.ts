export default class MaxTeamsCountReachedError extends Error {
  public constructor(maxCount: number) {
    super(`You can create up to ${maxCount} teams per Slack workspace.`);

    this.name = 'MaxTeamsCountReachedError';
  }
}
