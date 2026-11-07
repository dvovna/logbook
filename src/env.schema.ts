import { z } from 'zod';

// Only Supabase and Slack have to be configured; the limits have defaults.
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // A direct Postgres connection (Supabase: the session pooler on port 5432)
  // for the job queue. Without it background jobs run once, without retries.
  DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url().optional(),
  ),

  // Optional: only these Slack workspaces (T… IDs, comma-separated) may
  // install the app. Unset, any workspace that has the install link may.
  ALLOWED_SLACK_TEAM_IDS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(
        /^\s*[A-Z0-9]+(\s*,\s*[A-Z0-9]+)*\s*$/,
        'a comma-separated list of Slack workspace IDs, e.g. T0123ABCD,T0456EFGH',
      )
      .optional(),
  ),

  // Optional error tracking: unexpected errors go to this Sentry project.
  SENTRY_DSN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url().optional(),
  ),
  SENTRY_ENVIRONMENT: z.string().optional(),

  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_SIGN_IN_SECRET: z.string().min(1),
  SLACK_REDIRECT_URI: z.string().url(),

  // Encrypts the bot tokens stored in slack_teams: 32 random bytes, base64
  // (`openssl rand -base64 32`). Losing it means reinstalling the app in
  // every workspace.
  SLACK_TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((key) => Buffer.from(key, 'base64').length === 32, {
      message: 'must be 32 bytes, base64-encoded (openssl rand -base64 32)',
    }),

  // The range of years the year filters offer.
  MIN_YEAR: z.coerce.number().int().min(1900).default(2020),
  MAX_YEAR: z.coerce.number().int().max(2100).default(2035),

  // Per-user and per-workspace limits.
  MAX_REQUESTS_PER_USER: z.coerce.number().int().min(1).default(500),
  MAX_PENDING_REQUESTS_PER_USER: z.coerce.number().int().min(1).default(5),

  MAX_TEAMS_PER_SLACK_TEAM: z.coerce.number().int().min(1).default(10),
  MAX_CLIENTS_PER_SLACK_TEAM: z.coerce.number().int().min(1).default(10),
  MAX_PROJECTS_PER_SLACK_TEAM: z.coerce.number().int().min(1).default(10),
  MAX_POLICIES_PER_SLACK_TEAM: z.coerce.number().int().min(1).default(10),
  MAX_COMPANY_HOLIDAYS_PER_COMPANY_PER_YEAR: z.coerce
    .number()
    .int()
    .min(1)
    .default(5),
});

export type Env = z.infer<typeof envSchema>;
