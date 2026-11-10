import { BadRequestException } from '@nestjs/common';

// `field` names what was wrong in domain terms ('dates', 'minutes', 'name');
// a form shows the message at its matching field (BaseModalFormSubmitHandler).
export class ValidationError extends BadRequestException {
  public constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}
