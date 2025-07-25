import { Injectable } from '@nestjs/common';
import SlackApiClient from 'src/clients/third-party/slack-api.client';
import { ConfigService } from '@nestjs/config';

type IOauthCompleteResponseData = {
  access_token: string;
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

  public async exchangeCode(code: string): Promise<IOauthCompleteResponseData> {
    const clientId = this.config.get<string>('SLACK_CLIENT_ID')!;
    const clientSecret = this.config.get<string>('SLACK_CLIENT_SECRET')!;
    const redirectUri = this.config.get<string>('SLACK_REDIRECT_URI')!;

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
}
