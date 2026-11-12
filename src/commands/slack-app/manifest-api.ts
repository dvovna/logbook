import { ISlackAppManifest } from 'src/commands/slack-app/manifest';

export interface ICreatedSlackApp {
  app_id: string;
  credentials: {
    client_id: string;
    client_secret: string;
    signing_secret: string;
  };
}

interface ISlackAnswer {
  ok: boolean;
  error?: string;
  errors?: { message: string; pointer?: string }[];
}

export type Fetch = typeof fetch;

// Slack's app manifest API, called with an app configuration token (a
// workspace admin generates one at https://api.slack.com/apps; it lasts 12
// hours). The token goes in the Authorization header only.
export class SlackManifestApi {
  public constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  public create(manifest: ISlackAppManifest): Promise<ICreatedSlackApp> {
    return this.call<ICreatedSlackApp>('apps.manifest.create', {
      manifest: JSON.stringify(manifest),
    });
  }

  public async export(appId: string): Promise<ISlackAppManifest> {
    const { manifest } = await this.call<{ manifest: ISlackAppManifest }>(
      'apps.manifest.export',
      { app_id: appId },
    );

    return manifest;
  }

  public update(appId: string, manifest: ISlackAppManifest) {
    return this.call<{ app_id: string; permissions_updated: boolean }>(
      'apps.manifest.update',
      { app_id: appId, manifest: JSON.stringify(manifest) },
    );
  }

  public validate(manifest: ISlackAppManifest) {
    return this.call<object>('apps.manifest.validate', {
      manifest: JSON.stringify(manifest),
    });
  }

  private async call<T>(
    method: string,
    params: Record<string, string>,
  ): Promise<T> {
    const response = await this.fetchImpl(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    const answer = (await response.json()) as ISlackAnswer & T;

    if (!answer.ok) {
      throw new Error(slackErrorText(method, answer));
    }

    return answer;
  }
}

// Slack's code, what it means when it is about the token, and where the
// manifest is wrong when Slack says.
const slackErrorText = (method: string, { error, errors }: ISlackAnswer) => {
  const hints: Record<string, string> = {
    invalid_auth:
      'the app configuration token is wrong or expired: generate a new one at https://api.slack.com/apps (it lasts 12 hours)',
    token_expired:
      'the app configuration token has expired: generate a new one at https://api.slack.com/apps',
    not_allowed_token_type:
      'this is not an app configuration token: generate one at https://api.slack.com/apps, under "Your App Configuration Tokens"',
  };
  const details = (errors ?? [])
    .map(({ message, pointer }) => `  ${pointer ?? ''} ${message}`.trimEnd())
    .join('\n');

  return [
    `Slack refused ${method}: ${hints[error ?? ''] ?? error ?? 'no reason given'}`,
    ...(details ? [details] : []),
  ].join('\n');
};
