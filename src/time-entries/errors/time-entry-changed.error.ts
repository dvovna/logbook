import { ValidationError } from '@common/errors/validation.error';

// An entry changed between its check and its write (it was submitted or
// deleted in between), so nothing was written.
export class TimeEntryChangedError extends ValidationError {
  public static readonly MESSAGE =
    'This time changed after the form opened: open the form again.';

  public constructor() {
    super(TimeEntryChangedError.MESSAGE);
  }
}
