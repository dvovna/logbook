export default class PrimaryEntityDeleteError extends Error {
  public constructor(entityName: string) {
    super(`Primary ${entityName} cannot be deleted.`);

    this.name = 'PrimaryEntityDeleteError';
  }
}
