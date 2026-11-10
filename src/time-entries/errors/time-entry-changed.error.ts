import { ValidationError } from '@common/errors/validation.error';

// An entry changed between its check and its write (it was submitted or
// deleted in between), so nothing was written. `field`: where a form shows
// it.
export class TimeEntryChangedError extends ValidationError {
  public constructor(field?: string) {
    super(
      'This time changed after the form opened: open the form again.',
      field,
    );
  }
}
