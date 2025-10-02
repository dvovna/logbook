export class DuplicateError extends Error {
  public constructor(message: string) {
    super(message);

    this.name = 'DuplicateError';
  }
}
