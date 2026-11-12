import { parse } from 'yaml';
import { ISlackAppManifest } from 'src/api-clients/third-party/slack-manifest-api';

const DOMAIN_PLACEHOLDER = 'APP_DOMAIN';
// A host name, with a port for a tunnel that has one; no scheme and no path.
const DOMAIN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$/i;

export const assertDomain = (domain: string) => {
  if (!DOMAIN.test(domain)) {
    throw new Error(
      `"${domain}" isn't a domain: give the host the app answers on, such as logbook.example.com, without https:// or a path`,
    );
  }
};

// The repository's manifest with every APP_DOMAIN replaced, as the object
// Slack's manifest API takes.
export const manifestFor = (
  yaml: string,
  domain: string,
): ISlackAppManifest => {
  assertDomain(domain);

  return parse(
    yaml.replaceAll(DOMAIN_PLACEHOLDER, domain),
  ) as ISlackAppManifest;
};

// What the person named or wrote in the app's settings stays on an update:
// the app's name, description and color, and the bot's name. A dev app is
// usually called something else than the manifest's "Logbook".
export const keepingAppearance = (
  manifest: ISlackAppManifest,
  current: ISlackAppManifest,
): ISlackAppManifest => ({
  ...manifest,
  display_information: {
    ...manifest.display_information,
    ...current.display_information,
  },
  features: {
    ...manifest.features,
    bot_user: {
      ...manifest.features?.bot_user,
      ...(current.features?.bot_user?.display_name
        ? { display_name: current.features.bot_user.display_name }
        : {}),
    },
  },
});
