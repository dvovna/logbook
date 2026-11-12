import { checkApp } from 'src/checkup/app.check';
import { ICheckResult } from 'src/checkup/check.types';
import { failed, groupsOf, report, runCheckup } from 'src/checkup/checkup';
import { checkDatabase, Query } from 'src/checkup/database.check';
import { appDomainOf, checkEnv } from 'src/checkup/env.check';
import { checkSlackApp } from 'src/checkup/slack.check';
import { readShippedMigrations } from 'src/database/migrations-check.service';

const DOMAIN = 'logbook.example.com';
const ENV = {
  DATABASE_URL:
    'postgresql://postgres.ref:secret-password@pooler.example.com:5432/postgres',
  SLACK_CLIENT_ID: '111.222',
  SLACK_CLIENT_SECRET: 'client-secret',
  SLACK_SIGN_IN_SECRET: 'signing-secret',
  SLACK_REDIRECT_URI: `https://${DOMAIN}/api/slack/oauth/redirect`,
  SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const statuses = (results: ICheckResult[]) =>
  results.map(({ name, status }) => [name, status]);

const answering = (status: number | Error) =>
  (() =>
    status instanceof Error
      ? Promise.reject(status)
      : Promise.resolve({ status })) as unknown as typeof fetch;

describe('checkEnv', () => {
  it('passes a complete configuration', () => {
    expect(statuses(checkEnv(ENV))).toEqual([['Configuration', 'ok']]);
    expect(appDomainOf(ENV)).toBe(DOMAIN);
  });

  it('names each variable that is missing or malformed, never its value', () => {
    const results = checkEnv({
      ...ENV,
      SLACK_CLIENT_SECRET: '',
      SLACK_TOKEN_ENCRYPTION_KEY: 'too-short-secret',
    });

    expect(
      results.map(({ name, status, detail }) => [name, status, detail]),
    ).toEqual([
      ['SLACK_CLIENT_SECRET', 'fail', 'is not set'],
      [
        'SLACK_TOKEN_ENCRYPTION_KEY',
        'fail',
        'must be 32 bytes, base64-encoded (openssl rand -base64 32)',
      ],
    ]);
    expect(JSON.stringify(results)).not.toContain('too-short-secret');
  });

  it.each([
    `http://${DOMAIN}/api/slack/oauth/redirect`,
    `https://${DOMAIN}/oauth/redirect`,
  ])('refuses the redirect URI %s', (uri) => {
    const env = { ...ENV, SLACK_REDIRECT_URI: uri };

    expect(statuses(checkEnv(env))).toContainEqual([
      'SLACK_REDIRECT_URI',
      'fail',
    ]);
  });

  it("refuses Supabase's transaction pooler", () => {
    const results = checkEnv({
      ...ENV,
      DATABASE_URL: ENV.DATABASE_URL.replace(':5432', ':6543'),
    });

    expect(statuses(results)).toContainEqual(['DATABASE_URL', 'fail']);
    expect(JSON.stringify(results)).not.toContain('secret-password');
  });
});

describe('checkDatabase', () => {
  const shipped = readShippedMigrations();

  // Answers each statement by what it reads.
  const database = (
    overrides: Partial<
      Record<
        'history' | 'versions' | 'roles' | 'noRls' | 'grants' | 'functions',
        unknown[]
      >
    > = {},
  ) => {
    const rows = {
      history: [{ present: true }],
      versions: shipped.map((version) => ({ version })),
      roles: [{ rolname: 'anon' }, { rolname: 'authenticated' }],
      noRls: [],
      grants: [],
      functions: [],
      ...overrides,
    };
    const query: Query = (sql) =>
      Promise.resolve(
        (sql.includes('to_regclass')
          ? rows.history
          : sql.includes('schema_migrations')
            ? rows.versions
            : sql.includes('pg_roles')
              ? rows.roles
              : sql.includes('relrowsecurity')
                ? rows.noRls
                : sql.includes('role_table_grants')
                  ? rows.grants
                  : sql.includes('pg_proc')
                    ? rows.functions
                    : [{ one: 1 }]) as Record<string, unknown>[],
      );
    const close = jest.fn().mockResolvedValue(undefined);

    return { connect: () => Promise.resolve({ query, close }), close };
  };
  // Each read of the clock is `step` ms after the one before.
  const clock = (step: number) => {
    let now = 0;

    return () => (now += step);
  };

  it('passes a database with every migration, closed to the API roles, close by', async () => {
    const { connect, close } = database();

    expect(statuses(await checkDatabase(connect, clock(3)))).toEqual([
      ['Database', 'ok'],
      ['Migrations', 'ok'],
      ['API access', 'ok'],
      ['Round trip to the database', 'ok'],
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('names the migrations that are not applied', async () => {
    const { connect } = database({
      versions: shipped.slice(0, -2).map((version) => ({ version })),
    });
    const [, migrations] = await checkDatabase(connect, clock(1));

    expect(migrations).toMatchObject({
      status: 'fail',
      detail: `2 of this release's are not applied: ${shipped.slice(-2).join(', ')}`,
    });
  });

  it('fails a database with no migration history', async () => {
    const { connect } = database({ history: [{ present: false }] });

    expect((await checkDatabase(connect, clock(1)))[1]).toMatchObject({
      status: 'fail',
      detail: 'the database has no migration history',
    });
  });

  it('names what the API roles can reach', async () => {
    const { connect } = database({
      noRls: [{ relname: 'notes' }],
      functions: [{ proname: 'get_notes' }],
    });

    expect((await checkDatabase(connect, clock(1)))[2]).toMatchObject({
      status: 'fail',
      detail:
        'tables without row-level security: notes; functions the API roles may run: get_notes',
    });
  });

  it('skips the API roles on a Postgres that has none', async () => {
    const { connect } = database({ roles: [] });

    expect((await checkDatabase(connect, clock(1)))[2].status).toBe('skip');
  });

  it('warns about a database far away', async () => {
    const { connect } = database();
    const latency = (await checkDatabase(connect, clock(100)))[3];

    expect(latency).toMatchObject({ status: 'warn', detail: '100 ms' });
  });

  it('says so when it can not connect, and checks nothing more', async () => {
    const results = await checkDatabase(() =>
      Promise.reject(new Error('password authentication failed')),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'fail',
      detail: "can't connect: password authentication failed",
    });
  });
});

describe('checkApp', () => {
  it.each([
    [200, 'ok'],
    [503, 'fail'],
    [404, 'fail'],
    [new Error('getaddrinfo ENOTFOUND'), 'fail'],
  ])('reads /health answering %s as %s', async (answer, status) => {
    const [result] = await checkApp(DOMAIN, answering(answer));

    expect(result.status).toBe(status);
    expect(result.detail).toContain(`https://${DOMAIN}/health`);
  });

  it('skips while no domain is configured', async () => {
    expect((await checkApp(null))[0].status).toBe('skip');
  });
});

describe('checkSlackApp', () => {
  const env = {
    ...ENV,
    SLACK_APP_ID: 'A0APP',
    SLACK_CONFIG_TOKEN: 'xoxe.xoxp-config',
  };
  const exporting = (manifest: object | { error: string }) =>
    (() =>
      Promise.resolve({
        json: () =>
          Promise.resolve(
            'error' in manifest
              ? { ok: false, ...manifest }
              : { ok: true, manifest },
          ),
      })) as unknown as typeof fetch;
  const manifestOn = (host: string) => ({
    display_information: { name: 'Logbook' },
    features: {
      slash_commands: [
        { command: '/log', url: `https://${host}/api/slack/log` },
      ],
    },
    settings: {
      event_subscriptions: {
        request_url: `https://${DOMAIN}/api/slack/events`,
      },
    },
  });

  it("passes an app whose URLs are all on the app's domain", async () => {
    const [result] = await checkSlackApp(
      env,
      DOMAIN,
      exporting(manifestOn(DOMAIN)),
    );

    expect(result).toMatchObject({
      status: 'ok',
      detail: `A0APP calls ${DOMAIN} (2 URLs)`,
    });
  });

  it('names another domain the app still calls, and the command that fixes it', async () => {
    const [result] = await checkSlackApp(
      env,
      DOMAIN,
      exporting(manifestOn('old-tunnel.ngrok-free.app')),
    );

    expect(result).toMatchObject({
      status: 'fail',
      detail: 'A0APP calls another domain: old-tunnel.ngrok-free.app',
      fix: `Point it at this one: pnpm slack:app update --domain ${DOMAIN}`,
    });
  });

  it("tells Slack's refusal without the token", async () => {
    const [result] = await checkSlackApp(
      env,
      DOMAIN,
      exporting({ error: 'token_expired' }),
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('the app configuration token has expired');
    expect(JSON.stringify(result)).not.toContain('xoxe');
  });

  it('skips without the app ID or the token', async () => {
    const [result] = await checkSlackApp(ENV, DOMAIN);

    expect(result).toMatchObject({
      status: 'skip',
      detail:
        'needs SLACK_APP_ID and SLACK_CONFIG_TOKEN (an app configuration token)',
    });
  });
});

describe('checkup', () => {
  it('runs only the checks asked for, in its own order', async () => {
    const connect = jest.fn();
    const results = await runCheckup(groupsOf(['app', 'env']), {
      env: ENV,
      connect,
      fetch: answering(200),
    });

    expect(statuses(results)).toEqual([
      ['Configuration', 'ok'],
      ['Logbook from outside', 'ok'],
    ]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses a check it does not know', () => {
    expect(() => groupsOf(['env', 'slak'])).toThrow('Unknown check: slak');
  });

  it('reports a line a check, what to do under the ones that need it, and the counts', () => {
    const results: ICheckResult[] = [
      { name: 'Configuration', status: 'ok', detail: 'fine', fix: 'unused' },
      {
        name: 'Round trip',
        status: 'warn',
        detail: '100 ms',
        fix: 'Move closer',
      },
      {
        name: 'Migrations',
        status: 'fail',
        detail: '1 missing',
        fix: 'Apply it',
      },
      { name: 'Slack app', status: 'skip', detail: 'no token' },
    ];

    expect(report(results)).toBe(
      [
        '✓ Configuration: fine',
        '! Round trip: 100 ms',
        '    → Move closer',
        '✗ Migrations: 1 missing',
        '    → Apply it',
        '– Slack app: no token',
        '',
        '1 ok, 1 to look at, 1 failed, 1 skipped',
      ].join('\n'),
    );
    expect(failed(results)).toBe(true);
    expect(failed(results.filter(({ status }) => status !== 'fail'))).toBe(
      false,
    );
  });
});
