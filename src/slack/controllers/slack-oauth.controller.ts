import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import SlackOauthService from '@modules/slack/services/slack-oauth.service';
import { Response } from 'express';
import { TeamSetupWorkflowService } from '@modules/team-setup/team-setup-workflow.service';

@Controller('api/slack')
export default class SlackOauthController {
  private readonly logger = new Logger(SlackOauthController.name);

  public constructor(
    private readonly slackOauthService: SlackOauthService,
    private readonly teamSetupWorkflowService: TeamSetupWorkflowService,
  ) {}

  @Get('/oauth/redirect')
  public async handleOAuthRedirect(
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    try {
      const data = await this.slackOauthService.exchangeCode(code);

      const slackTeamId = data.team.id;
      const slackTeamName = data.team.name;
      const slackUserId = data.authed_user.id;
      const accessToken = data.access_token;

      await this.teamSetupWorkflowService.execute({
        slackTeamId,
        slackTeamName,
        teamSlackToken: accessToken,
        slackUserId,
      });

      return res.redirect('/success.html');
    } catch (error) {
      this.logger.error('OAuth error:', error);
      return res.status(500).send('OAuth failed');
    }
  }
}
