// Runs in every test worker before the test file is loaded, so it is in place
// before AppModule validates the environment. The Supabase variables come from
// global-setup.ts; everything else is fixed here, so the developer's .env never
// matters (process.env wins over .env in ConfigModule).
export const TEST_SLACK_SIGNING_SECRET = 'integration-test-signing-secret';
export const TEST_SLACK_CLIENT_ID = 'integration-test-client-id';
export const TEST_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const testEnv: Record<string, string> = {
  SLACK_CLIENT_ID: TEST_SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: 'integration-test-client-secret',
  SLACK_SIGN_IN_SECRET: TEST_SLACK_SIGNING_SECRET,
  SLACK_REDIRECT_URI: 'http://localhost/api/slack/oauth/redirect',
  SLACK_TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,

  MIN_YEAR: '2020',
  MAX_YEAR: '2100',
  MAX_REQUESTS_PER_USER: '500',
  MAX_PENDING_REQUESTS_PER_USER: '5',
  MAX_TEAMS_PER_SLACK_TEAM: '10',
  MAX_CLIENTS_PER_SLACK_TEAM: '10',
  MAX_PROJECTS_PER_SLACK_TEAM: '10',
  MAX_POLICIES_PER_SLACK_TEAM: '10',
  MAX_COMPANY_HOLIDAYS_PER_COMPANY_PER_YEAR: '50',
};

Object.assign(process.env, testEnv);

// The job queue uses the local database too (global-setup checked it is local).
process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;

// App logs are noise in test output; `LOG_LEVEL=debug yarn test:int` shows them.
process.env.LOG_LEVEL ??= 'silent';

for (const name of [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is not set: global-setup.ts did not run`);
  }
}
