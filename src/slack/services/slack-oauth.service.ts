import { Injectable } from '@nestjs/common';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { ConfigService } from '@nestjs/config';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

// The bot scopes the app asks for; keep them in line with slack-app-manifest.yml.
export const SLACK_BOT_SCOPES = [
  'commands',
  'chat:write',
  'files:read',
  // Time report CSVs in DMs.
  'files:write',
  'users:read',
  'users:read.email',
];

type IOauthCompleteResponseData = {
  access_token: string;
  // With token rotation on: the bot token expires after `expires_in`
  // seconds and the refresh token gets the next one.
  refresh_token?: string;
  expires_in?: number;
  team: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
    access_token: string;
    scope: string;
    token_type: string;
  };
};

@Injectable()
export default class SlackOauthService {
  public constructor(
    private readonly slackApiClient: SlackApiClient,
    private readonly config: ConfigService,
  ) {}

  public getAuthorizeUrl(state: string) {
    const url = new URL('https://slack.com/oauth/v2/authorize');

    url.search = new URLSearchParams({
      client_id: this.config.get<string>(EnvironmentVariable.SlackClientId)!,
      scope: SLACK_BOT_SCOPES.join(','),
      redirect_uri: this.config.get<string>(
        EnvironmentVariable.SlackRedirectUri,
      )!,
      state,
    }).toString();

    return url.toString();
  }

  public async exchangeCode(code: string): Promise<IOauthCompleteResponseData> {
    const clientId = this.config.get<string>(
      EnvironmentVariable.SlackClientId,
    )!;
    const clientSecret = this.config.get<string>(
      EnvironmentVariable.SlackClientSecret,
    )!;
    const redirectUri = this.config.get<string>(
      EnvironmentVariable.SlackRedirectUri,
    )!;

    const result =
      await this.slackApiClient.makeCall<IOauthCompleteResponseData>(
        'oauth.v2.access',
        {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
      );

    if (!result.ok) {
      throw new Error(result.error || 'Slack OAuth failed');
    }

    return result;
  }

  // ALLOWED_SLACK_TEAM_IDS limits the workspaces that may install the app on
  // this server; without it every workspace may.
  public isAllowedWorkspace(slackTeamId: string) {
    const allowed = this.config.get<string>(
      EnvironmentVariable.AllowedSlackTeamIds,
    );

    if (!allowed) {
      return true;
    }

    return allowed
      .split(',')
      .map((id) => id.trim())
      .includes(slackTeamId);
  }

  // Undoes an install the server refuses, so no token is left behind.
  public async revokeToken(accessToken: string) {
    await this.slackApiClient.makeCall('auth.revoke', {}, accessToken);
  }
}
