export default class TeamDeleteError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TeamDeleteError';
  }
}
