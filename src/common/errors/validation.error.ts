import { BadRequestException } from '@nestjs/common';

export class ValidationError extends BadRequestException {
  public constructor(message: string) {
    super(message);
  }
}
