import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import SlackOauthService from '@modules/slack/services/slack-oauth.service';
import { Request, Response } from 'express';
import { TeamSetupWorkflowService } from '@modules/team-setup/team-setup-workflow.service';

const STATE_COOKIE = 'slack_oauth_state';
const STATE_COOKIE_PATH = '/api/slack/oauth';
const STATE_TTL_MS = 10 * 60 * 1000;

// The pages of public/ that say how an install ended. They read these
// parameters and nothing else, and show none of them as text.
const INSTALLED_PAGE = '/success.html';
const FAILED_PAGE = '/install-failed.html';

type FailureReason = 'canceled' | 'expired' | 'workspace' | 'failed';

const failedPage = (reason: FailureReason) => `${FAILED_PAGE}?reason=${reason}`;

const readCookie = (req: Request, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];

const sameState = (expected: string | undefined, actual: string | undefined) =>
  !!expected &&
  !!actual &&
  expected.length === actual.length &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

// Installing goes through /install, which binds a random `state` to the
// browser in a cookie. The redirect only accepts a code that comes back with
// the same state, so nobody can make another person's browser complete an
// installation they started (OAuth CSRF).
@Controller('api/slack')
export default class SlackOauthController {
  private readonly logger = new Logger(SlackOauthController.name);

  public constructor(
    private readonly slackOauthService: SlackOauthService,
    private readonly teamSetupWorkflowService: TeamSetupWorkflowService,
  ) {}

  @Get('/install')
  public startInstall(@Res() res: Response) {
    const state = randomBytes(24).toString('hex');

    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_MS,
    });

    return res.redirect(this.slackOauthService.getAuthorizeUrl(state));
  }

  @Get('/oauth/redirect')
  public async handleOAuthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const expectedState = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

    if (error) {
      return res.redirect(failedPage('canceled'));
    }

    if (!sameState(expectedState, state)) {
      this.logger.warn('OAuth redirect with a missing or wrong state');

      return res.redirect(failedPage('expired'));
    }

    try {
      const data = await this.slackOauthService.exchangeCode(code);

      if (!this.slackOauthService.isAllowedWorkspace(data.team.id)) {
        this.logger.warn(
          `Refused an install from workspace ${data.team.id}: not in ALLOWED_SLACK_TEAM_IDS`,
        );
        await this.slackOauthService
          .revokeToken(data.access_token)
          .catch((revokeError: Error) =>
            this.logger.error(
              `Failed to revoke the refused install's token: ${revokeError.message}`,
            ),
          );

        return res.redirect(failedPage('workspace'));
      }

      const outcome = await this.teamSetupWorkflowService.execute({
        slackTeamId: data.team.id,
        slackTeamName: data.team.name,
        tokens: {
          token: data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresAt: data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : null,
        },
        slackUserId: data.authed_user.id,
      });

      // The workspace and the app, for the page's button to Logbook's Home:
      // IDs, which Slack shows in its own addresses.
      const page = new URLSearchParams({
        installed: outcome,
        team: data.team.id,
        ...(data.app_id ? { app: data.app_id } : {}),
      });

      return res.redirect(`${INSTALLED_PAGE}?${page.toString()}`);
    } catch (error) {
      this.logger.error('OAuth error:', error);

      return res.redirect(failedPage('failed'));
    }
  }
}
