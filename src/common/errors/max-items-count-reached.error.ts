export default class MaxItemsCountReachedError extends Error {
  public constructor(maxCount: number, itemName = 'items') {
    super(`You can create up to ${maxCount} ${itemName} per Slack workspace.`);

    this.name = 'MaxItemsCountReachedError';
  }
}
