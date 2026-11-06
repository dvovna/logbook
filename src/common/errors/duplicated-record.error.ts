export class DuplicatedRecordError extends Error {
  public constructor(message: string) {
    super(message);

    this.name = 'DuplicateError';
  }
}
