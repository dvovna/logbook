import {
  ISlackAppManifest,
  SlackManifestApi,
} from 'src/api-clients/third-party/slack-manifest-api';
import { EnvVars, ICheckResult } from 'src/checkup/check.types';

const urlsOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? /^https?:\/\//.test(value)
      ? [value]
      : []
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(urlsOf)
      : [];

// Whether every URL of the Slack app's manifest is on the configured
// domain: a tunnel that got a new address, or an app made for another
// domain, leaves Slack calling somewhere else. Needs the app's ID and an
// app configuration token. Whether the manifest is the release's is
// `pnpm slack:app update`'s to settle: it is safe to run again.
export async function checkSlackApp(
  env: EnvVars,
  domain: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ICheckResult[]> {
  const name = 'Slack app';
  const { SLACK_APP_ID: appId, SLACK_CONFIG_TOKEN: token } = env;

  if (!appId || !token || !domain) {
    return [
      {
        name,
        status: 'skip',
        detail: !domain
          ? "SLACK_REDIRECT_URI doesn't name the domain yet"
          : `needs ${[!appId && 'SLACK_APP_ID', !token && 'SLACK_CONFIG_TOKEN (an app configuration token)'].filter(Boolean).join(' and ')}`,
      },
    ];
  }

  let manifest: ISlackAppManifest;

  try {
    manifest = await new SlackManifestApi(token, fetchImpl).export(appId);
  } catch (error) {
    return [
      {
        name,
        status: 'fail',
        detail: (error as Error).message,
        fix: 'Check SLACK_APP_ID and the token',
      },
    ];
  }

  const urls = urlsOf(manifest);
  const elsewhere = urls.filter((url) => new URL(url).host !== domain);

  if (!urls.length) {
    return [
      {
        name,
        status: 'fail',
        detail: `${appId} has no request URLs`,
        fix: `Bring it to the manifest: pnpm slack:app update --domain ${domain}`,
      },
    ];
  }

  return [
    elsewhere.length
      ? {
          name,
          status: 'fail',
          detail: `${appId} calls another domain: ${[...new Set(elsewhere.map((url) => new URL(url).host))].join(', ')}`,
          fix: `Point it at this one: pnpm slack:app update --domain ${domain}`,
        }
      : {
          name,
          status: 'ok',
          detail: `${appId} calls ${domain} (${urls.length} URLs)`,
        },
  ];
}
