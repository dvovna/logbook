export class DuplicatedRecordError extends Error {
  public constructor(
    message: string,
    // The field whose value is taken, as for ValidationError.
    public readonly field = 'name',
  ) {
    super(message);

    this.name = 'DuplicateError';
  }
}
