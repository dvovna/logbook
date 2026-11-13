import { ValidationError } from '@common/errors/validation.error';

// A ValidationError, so that forms and buttons show its message as a refusal.
export class ReceiptChangedError extends ValidationError {
  public constructor() {
    super('This receipt was changed meanwhile.');
  }
}
