import { Controller, Get, Query, Res } from '@nestjs/common';
import { SlackService } from './slack.service';
import { Response } from 'express';

@Controller('slack')
export class SlackController {
  public constructor(private readonly slackService: SlackService) {}

  @Get('/oauth/redirect')
  public async handleOAuthRedirect(
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    try {
      await this.slackService.exchangeCodeAndCreateTeam(code);

      return res.redirect('/success');
    } catch (error) {
      console.error('OAuth error:', error);
      return res.status(500).send('OAuth failed');
    }
  }
}
