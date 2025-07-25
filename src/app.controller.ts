import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  public constructor() {}

  @Get()
  public getStatus(): string {
    return 'Up and running!';
  }
}
