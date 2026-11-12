import { envSchema } from 'src/env.schema';
import { EnvVars, ICheckResult } from 'src/checkup/check.types';

const REDIRECT_PATH = '/api/slack/oauth/redirect';
// Supabase's transaction pooler: no session state, so no advisory locks and
// no job queue.
const TRANSACTION_POOLER_PORT = '6543';

const urlOf = (value: string | undefined) => {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
};

// The host Slack reaches the app on, from the redirect URI: the one place
// the configuration names it.
export const appDomainOf = (env: EnvVars): string | null => {
  const url = urlOf(env.SLACK_REDIRECT_URI);

  return url && url.pathname === REDIRECT_PATH ? url.host : null;
};

// The variables, by the schema the app itself starts with. A problem names
// the variable and what is wrong with it, never its value.
export const checkEnv = (env: EnvVars): ICheckResult[] => {
  const parsed = envSchema.safeParse(env);
  const results: ICheckResult[] = parsed.success
    ? [
        {
          name: 'Configuration',
          status: 'ok',
          detail: 'every required variable is set and well formed',
        },
      ]
    : parsed.error.issues.map((issue) => {
        const variable = String(issue.path[0]);

        return {
          name: variable,
          status: 'fail',
          detail:
            env[variable] === undefined || env[variable] === ''
              ? 'is not set'
              : issue.message,
          fix: `Set ${variable} in .env (the Configuration reference says what it takes)`,
        };
      });

  const redirect = urlOf(env.SLACK_REDIRECT_URI);

  if (
    redirect &&
    (redirect.protocol !== 'https:' || redirect.pathname !== REDIRECT_PATH)
  ) {
    results.push({
      name: 'SLACK_REDIRECT_URI',
      status: 'fail',
      detail: `has to be https://<your-domain>${REDIRECT_PATH}`,
      fix: 'Set it to the domain Slack reaches Logbook on, with that path; `pnpm slack:app update --domain <domain>` writes it',
    });
  }

  if (urlOf(env.DATABASE_URL)?.port === TRANSACTION_POOLER_PORT) {
    results.push({
      name: 'DATABASE_URL',
      status: 'fail',
      detail: `points at port ${TRANSACTION_POOLER_PORT}, Supabase's transaction pooler`,
      fix: 'Use the session pooler connection string (port 5432) from the project\'s "Connect" dialog',
    });
  }

  return results;
};
