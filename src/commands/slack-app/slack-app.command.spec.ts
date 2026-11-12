import { readFileSync } from 'fs';
import { envValue, withEnvValues } from 'src/commands/slack-app/env-file';
import { manifestFor } from 'src/commands/slack-app/manifest';
import {
  ISlackAppDeps,
  slackApp,
} from 'src/commands/slack-app/slack-app.command';

const MANIFEST = readFileSync('slack-app-manifest.yml', 'utf8');
const DOMAIN = 'logbook.example.com';

describe('env file', () => {
  it('replaces a key in place and adds a missing one at the end', () => {
    const before = '# Slack\nSLACK_CLIENT_ID=old\nPORT=3000';

    expect(
      withEnvValues(before, { SLACK_CLIENT_ID: '1.2', SLACK_APP_ID: 'A1' }),
    ).toBe('# Slack\nSLACK_CLIENT_ID=1.2\nPORT=3000\nSLACK_APP_ID=A1\n');
  });

  it('keeps a value with $ or spaces whole', () => {
    const content = withEnvValues('SECRET=x\n', { SECRET: 'a$1 b' });

    expect(content).toBe('SECRET="a$1 b"\n');
    expect(envValue(content, 'SECRET')).toBe('a$1 b');
    expect(envValue(content, 'OTHER')).toBeUndefined();
  });
});

describe('manifestFor', () => {
  it('puts the domain into every URL of the manifest', () => {
    const manifest = manifestFor(MANIFEST, DOMAIN);

    expect(JSON.stringify(manifest)).not.toContain('APP_DOMAIN');
    expect(
      JSON.stringify(manifest).match(/logbook\.example\.com/g),
    ).toHaveLength(6);
    expect(manifest.display_information.name).toBe('Logbook');
  });

  it.each([
    'https://logbook.example.com',
    'logbook.example.com/x',
    'localhost',
  ])('refuses %s as a domain', (domain) => {
    expect(() => manifestFor(MANIFEST, domain)).toThrow("isn't a domain");
  });
});

describe('slack:app', () => {
  let files: Record<string, string>;
  let printed: string[];
  let calls: { method: string; token: string; params: URLSearchParams }[];
  let answers: Record<string, object>;

  const deps = (): ISlackAppDeps => ({
    readFile: (path) => files[path],
    writeFile: (path, content) => {
      files[path] = content;
    },
    token: () => Promise.resolve('xoxe.xoxp-config'),
    print: (line) => printed.push(line),
    fetch: ((url: string, init: RequestInit) => {
      const method = url.replace('https://slack.com/api/', '');

      calls.push({
        method,
        token: (init.headers as Record<string, string>).Authorization,
        params: new URLSearchParams(init.body as string),
      });

      return Promise.resolve({
        json: () => Promise.resolve(answers[method] ?? { ok: true }),
      });
    }) as unknown as typeof fetch,
  });

  beforeEach(() => {
    files = { 'slack-app-manifest.yml': MANIFEST };
    printed = [];
    calls = [];
    answers = {
      'apps.manifest.create': {
        ok: true,
        app_id: 'A0NEW',
        credentials: {
          client_id: '111.222',
          client_secret: 'client-secret',
          signing_secret: 'signing-secret',
          verification_token: 'unused',
        },
      },
      'apps.manifest.export': {
        ok: true,
        manifest: {
          display_information: {
            name: 'Logbook (dev)',
            background_color: '#590088',
          },
          features: { bot_user: { display_name: 'logbook-dev' } },
          settings: {
            event_subscriptions: {
              request_url: 'https://old.example.com/api/slack/events',
            },
          },
        },
      },
      'apps.manifest.update': {
        ok: true,
        app_id: 'A0OLD',
        permissions_updated: false,
      },
    };
  });

  it('creates the app and writes its secrets to .env without printing them', async () => {
    files['.env'] = 'DATABASE_URL=postgres://x\nSLACK_CLIENT_ID=\n';

    await slackApp(
      ['create', '--domain', DOMAIN, '--name', 'Logbook (dev)'],
      deps(),
    );

    expect(calls.map(({ method, token }) => [method, token])).toEqual([
      ['apps.manifest.create', 'Bearer xoxe.xoxp-config'],
    ]);
    const sent = JSON.parse(calls[0].params.get('manifest')!);
    expect(sent.display_information.name).toBe('Logbook (dev)');
    expect(sent.settings.event_subscriptions.request_url).toBe(
      `https://${DOMAIN}/api/slack/events`,
    );
    expect(files['.env']).toBe(
      [
        'DATABASE_URL=postgres://x',
        'SLACK_CLIENT_ID=111.222',
        'SLACK_APP_ID=A0NEW',
        'SLACK_CLIENT_SECRET=client-secret',
        'SLACK_SIGN_IN_SECRET=signing-secret',
        `SLACK_REDIRECT_URI=https://${DOMAIN}/api/slack/oauth/redirect`,
        '',
      ].join('\n'),
    );
    expect(printed.join('\n')).toContain('Created the Slack app A0NEW');
    expect(printed.join('\n')).not.toMatch(/client-secret|signing-secret|xoxe/);
  });

  it('creates a .env when there is none', async () => {
    await slackApp(['create', '--domain', DOMAIN], deps());

    expect(envValue(files['.env'], 'SLACK_APP_ID')).toBe('A0NEW');
  });

  it('refuses to create a second app over the one .env names', async () => {
    files['.env'] = 'SLACK_APP_ID=A0OLD\n';

    await expect(
      slackApp(['create', '--domain', DOMAIN], deps()),
    ).rejects.toThrow('already names a Slack app (SLACK_APP_ID=A0OLD)');
    expect(calls).toEqual([]);
  });

  it("updates the app .env names to a new domain, keeping the app's own name", async () => {
    files['.env'] =
      'SLACK_APP_ID=A0OLD\nSLACK_REDIRECT_URI=https://old.example.com/api/slack/oauth/redirect\n';

    await slackApp(['update', '--domain', 'new.example.com'], deps());

    expect(calls.map(({ method }) => method)).toEqual([
      'apps.manifest.export',
      'apps.manifest.update',
    ]);
    expect(calls[1].params.get('app_id')).toBe('A0OLD');
    const sent = JSON.parse(calls[1].params.get('manifest')!);
    expect(sent.display_information).toEqual({
      name: 'Logbook (dev)',
      description:
        "Your team's hours and time off: vacation requests, approvals and time tracking",
      background_color: '#590088',
    });
    expect(sent.features.bot_user.display_name).toBe('logbook-dev');
    expect(
      sent.features.slash_commands.map((c: { command: string }) => c.command),
    ).toEqual(['/vacations', '/log']);
    expect(sent.settings.interactivity.request_url).toBe(
      'https://new.example.com/api/slack/interactions',
    );
    expect(files['.env']).toBe(
      'SLACK_APP_ID=A0OLD\nSLACK_REDIRECT_URI=https://new.example.com/api/slack/oauth/redirect\n',
    );
    expect(printed.join('\n')).not.toContain('install it again');
  });

  it('says to install again when the update changed the scopes', async () => {
    answers['apps.manifest.update'] = { ok: true, permissions_updated: true };

    await slackApp(['update', '--domain', DOMAIN, '--app', 'A0OLD'], deps());

    expect(printed.join('\n')).toContain(
      `install it again in every workspace at https://${DOMAIN}/api/slack/install`,
    );
    expect(envValue(files['.env'], 'SLACK_APP_ID')).toBe('A0OLD');
  });

  it('asks which app when neither --app nor .env says', async () => {
    await expect(
      slackApp(['update', '--domain', DOMAIN], deps()),
    ).rejects.toThrow('Which app?');
  });

  it("tells Slack's reason and where the manifest is wrong", async () => {
    answers['apps.manifest.validate'] = {
      ok: false,
      error: 'invalid_manifest',
      errors: [{ message: 'must be a valid URL', pointer: '/settings/x' }],
    };

    await expect(slackApp(['validate'], deps())).rejects.toThrow(
      'Slack refused apps.manifest.validate: invalid_manifest\n  /settings/x must be a valid URL',
    );
  });

  it('says what an expired token needs', async () => {
    answers['apps.manifest.validate'] = { ok: false, error: 'token_expired' };

    await expect(slackApp(['validate'], deps())).rejects.toThrow(
      'the app configuration token has expired',
    );
  });

  it.each([[[]], [['install']], [['create', '--domian', 'x']]])(
    'shows the usage for %j',
    async (args) => {
      await expect(slackApp(args, deps())).rejects.toThrow('Usage:');
    },
  );
});
