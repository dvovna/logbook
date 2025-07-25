import { ConfigService } from '@nestjs/config';

interface IOauthCompleteData {
  ok: boolean;
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
}

export default class SlackApiClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  public constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('SLACK_CLIENT_ID')!;
    this.clientSecret = this.config.get<string>('SLACK_BOT_TOKEN')!;
    this.redirectUri = this.config.get<string>('SLACK_REDIRECT_URI')!;
  }

  public async exchangeCode(code: string): Promise<IOauthCompleteData> {
    const url = 'https://slack.com/api/oauth.v2.access';
    const params = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
    });

    return await fetch(`${url}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) {
          throw new Error(data.error || 'Slack OAuth failed');
        }
        return data;
      });
  }
}
