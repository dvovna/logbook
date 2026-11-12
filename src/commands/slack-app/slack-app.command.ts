import { envValue, withEnvValues } from 'src/commands/slack-app/env-file';
import {
  Fetch,
  SlackManifestApi,
} from 'src/api-clients/third-party/slack-manifest-api';
import {
  keepingAppearance,
  manifestFor,
} from 'src/commands/slack-app/manifest';

export const USAGE = [
  'Usage:',
  '  pnpm slack:app create --domain <domain> [--name <app name>] [--env <file>]',
  '  pnpm slack:app update --domain <domain> [--app <app id>] [--env <file>]',
  '  pnpm slack:app validate [--domain <domain>]',
  '',
  'The app configuration token (https://api.slack.com/apps, "Your App',
  'Configuration Tokens") is read from SLACK_CONFIG_TOKEN, or asked for.',
].join('\n');

const MANIFEST_FILE = 'slack-app-manifest.yml';
const ENV_EXAMPLE_FILE = '.env.example';
const APP_ID = 'SLACK_APP_ID';

// What the command touches outside itself, so a spec can stand in for it.
export interface ISlackAppDeps {
  readFile: (path: string) => string | undefined;
  writeFile: (path: string, content: string) => void;
  token: () => Promise<string>;
  print: (line: string) => void;
  fetch?: Fetch;
}

interface IOptions {
  domain?: string;
  name?: string;
  app?: string;
  env: string;
}

const optionsOf = (flags: string[]): IOptions => {
  const options: IOptions = { env: '.env' };

  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    const key = flag.replace(/^--/, '');

    if (!['domain', 'name', 'app', 'env'].includes(key) || flag === key) {
      throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    }

    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    options[key as keyof IOptions] = value;
  }

  return options;
};

const required = (domain: string | undefined) => {
  if (!domain) {
    throw new Error(`--domain is required\n\n${USAGE}`);
  }

  return domain;
};

// Creates the Slack app from the repository's manifest, or brings an
// existing one to it, through Slack's manifest API. The app's secrets go
// from Slack's answer into the .env file and are never printed.
export async function slackApp(
  [command, ...flags]: string[],
  deps: ISlackAppDeps,
): Promise<void> {
  if (!['create', 'update', 'validate'].includes(command)) {
    throw new Error(USAGE);
  }

  const options = optionsOf(flags);
  const yaml = deps.readFile(MANIFEST_FILE);

  if (yaml === undefined) {
    throw new Error(
      `${MANIFEST_FILE} not found: run the command in the repository's root`,
    );
  }

  const api = async () => new SlackManifestApi(await deps.token(), deps.fetch);

  if (command === 'validate') {
    // Any domain makes the URLs valid; Slack checks the manifest's shape.
    await (
      await api()
    ).validate(manifestFor(yaml, options.domain ?? 'logbook.example.com'));
    deps.print('The manifest is valid.');

    return;
  }

  const domain = required(options.domain);
  const manifest = manifestFor(yaml, domain);
  // A file that isn't there yet starts as the example, with its comments
  // and the other keys to fill in.
  const env =
    deps.readFile(options.env) ?? deps.readFile(ENV_EXAMPLE_FILE) ?? '';
  const redirectUri = `https://${domain}/api/slack/oauth/redirect`;

  if (command === 'create') {
    // A second app would leave the first one's secrets in no file.
    const existing = envValue(env, APP_ID);

    if (existing) {
      throw new Error(
        `${options.env} already names a Slack app (${APP_ID}=${existing}): use "update", or remove the line to create another app`,
      );
    }

    if (options.name) {
      manifest.display_information.name = options.name;
    }

    const { app_id: appId, credentials } = await (await api()).create(manifest);

    deps.writeFile(
      options.env,
      withEnvValues(env, {
        [APP_ID]: appId,
        SLACK_CLIENT_ID: credentials.client_id,
        SLACK_CLIENT_SECRET: credentials.client_secret,
        SLACK_SIGN_IN_SECRET: credentials.signing_secret,
        SLACK_REDIRECT_URI: redirectUri,
      }),
    );
    deps.print(
      [
        `Created the Slack app ${appId} for ${domain}.`,
        `Its client ID, client secret, signing secret and redirect URI are in ${options.env}.`,
        `Slack couldn't verify the events URL yet, since Logbook doesn't run there. Once it runs on ${domain}: open https://api.slack.com/apps/${appId}/event-subscriptions and click Retry until the Request URL says Verified. Only then install the app at https://${domain}/api/slack/install`,
      ].join('\n'),
    );

    return;
  }

  const appId = options.app ?? envValue(env, APP_ID);

  if (!appId) {
    throw new Error(
      `Which app? Pass --app <app id> (it is in the app's URL at https://api.slack.com/apps), or set ${APP_ID} in ${options.env}`,
    );
  }

  const slack = await api();
  const { permissions_updated: scopesChanged } = await slack.update(
    appId,
    keepingAppearance(manifest, await slack.export(appId)),
  );

  deps.writeFile(
    options.env,
    withEnvValues(env, { [APP_ID]: appId, SLACK_REDIRECT_URI: redirectUri }),
  );
  deps.print(
    [
      `Updated the Slack app ${appId} to ${domain}.`,
      `${options.env} has the new redirect URI: restart Logbook to use it.`,
      ...(scopesChanged
        ? [
            `Slack says the app's scopes changed. A scope the manifest added works only after the app is installed again, in every workspace, at https://${domain}/api/slack/install; one it took away needs nothing.`,
          ]
        : []),
    ].join('\n'),
  );
}
