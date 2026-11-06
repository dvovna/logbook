import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  SUPABASE_URL: z.url(),
  SUPABASE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z
    .string()
    .url()
    .refine((val) => val.startsWith('postgresql://'), {
      message: 'SUPABASE_DB_URL must be a valid PostgreSQL connection string',
    }),

  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_SIGN_IN_SECRET: z.string().min(1),
  SLACK_REDIRECT_URI: z.string().url(),

  MIN_YEAR: z.coerce.number().int().min(1900),
  MAX_YEAR: z.coerce.number().int().max(2100),

  MAX_REQUESTS_PER_USER: z.coerce.number().int().min(1),
  MAX_PENDING_REQUESTS_PER_USER: z.coerce.number().int().min(1),

  MAX_TEAMS_PER_SLACK_TEAM: z.coerce.number().int().min(1),
  MAX_CLIENTS_PER_SLACK_TEAM: z.coerce.number().int().min(1),
  MAX_PROJECTS_PER_SLACK_TEAM: z.coerce.number().int().min(1),
  MAX_POLICIES_PER_SLACK_TEAM: z.coerce.number().int().min(1),
  MAX_COMPANY_HOLIDAYS_PER_COMPANY_PER_YEAR: z.coerce.number().int().min(1),
});

export type Env = z.infer<typeof envSchema>;
