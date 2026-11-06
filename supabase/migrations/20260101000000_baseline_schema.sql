-- Baseline schema of the public tables, taken from the dev project
-- (pg_dump --schema-only) and made idempotent: IF NOT EXISTS everywhere,
-- constraints and types are created only when missing.
--
-- It is dated before the other migrations so a fresh database (local Supabase,
-- `supabase db reset`) gets the tables before the RPCs and constraints that
-- use them. On a database that already has the schema it changes nothing.
-- Functions are left to the later migrations. Further schema changes go into
-- new migrations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."ProjectStatus" AS ENUM (
        'active',
        'completed',
        'on-hold'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.billing_report_entries (
    slack_team_id uuid NOT NULL,
    report_id uuid NOT NULL,
    time_entry_id uuid NOT NULL
);

COMMENT ON TABLE public.billing_report_entries IS 'Links time entries to billing reports';

CREATE TABLE IF NOT EXISTS public.billing_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    team_id uuid NOT NULL,
    client_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_minutes integer NOT NULL,
    total_amount numeric(12,2),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_locked boolean DEFAULT false NOT NULL
);

COMMENT ON TABLE public.billing_reports IS 'Immutable billing snapshots';

COMMENT ON COLUMN public.billing_reports.is_locked IS 'Prevents any further modifications';

CREATE TABLE IF NOT EXISTS public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slack_team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    created_by uuid DEFAULT gen_random_uuid(),
    updated_by uuid DEFAULT gen_random_uuid(),
    description text,
    archived_by uuid DEFAULT gen_random_uuid()
);

COMMENT ON TABLE public.clients IS 'Clients for time tracking and billing';

CREATE TABLE IF NOT EXISTS public.holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vacation_policy_id uuid NOT NULL,
    slack_team_id uuid NOT NULL,
    name text NOT NULL,
    date date NOT NULL,
    year integer NOT NULL,
    is_company_custom boolean DEFAULT false NOT NULL,
    is_disabled boolean DEFAULT false NOT NULL,
    country_code text,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.project_teams (
    team_id uuid NOT NULL,
    project_id uuid NOT NULL,
    slack_team_id uuid DEFAULT gen_random_uuid() NOT NULL
);

COMMENT ON TABLE public.project_teams IS 'Links teams to projects available for time tracking';

CREATE TABLE IF NOT EXISTS public.project_users (
    slack_team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL
);

COMMENT ON TABLE public.project_users IS 'Links users to projects they are allowed to log time against';

CREATE TABLE IF NOT EXISTS public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slack_team_id uuid DEFAULT gen_random_uuid() NOT NULL,
    description text,
    archived_at timestamp with time zone,
    archived_by uuid DEFAULT gen_random_uuid(),
    created_by uuid,
    updated_by uuid,
    billable boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'on-hold'::text])))
);

COMMENT ON TABLE public.projects IS 'Projects under a client';

CREATE TABLE IF NOT EXISTS public.request_workflow_step_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    step_id uuid NOT NULL,
    slack_team_id uuid NOT NULL,
    slack_user_id text NOT NULL,
    created_by uuid NOT NULL,
    step_level smallint NOT NULL,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_workflow_step_comments_comment_check CHECK ((length(TRIM(BOTH FROM comment)) > 0))
);

CREATE TABLE IF NOT EXISTS public.request_workflow_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    slack_team_id uuid NOT NULL,
    step_type text NOT NULL,
    step_level smallint NOT NULL,
    step_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    slack_user_id text,
    slack_message_ts text,
    slack_channel_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT request_workflow_steps_step_level_check CHECK ((step_level > 0)),
    CONSTRAINT request_workflow_steps_step_type_check CHECK ((step_type = ANY (ARRAY['approver'::text, 'notifier'::text])))
);

CREATE TABLE IF NOT EXISTS public.slack_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slack_id text NOT NULL,
    slack_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    vacation_policy_id uuid,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manager_approvers text[],
    hr_approvers text[],
    approval_notification_recipients text[] DEFAULT '{}'::text[],
    manager_approvers_rule text DEFAULT '''ANY''::text'::text NOT NULL,
    hr_approvers_rule text DEFAULT '''ANY''::text'::text NOT NULL,
    CONSTRAINT teams_hr_approvers_rule_check CHECK ((hr_approvers_rule = ANY (ARRAY['ANY'::text, 'ALL'::text]))),
    CONSTRAINT teams_manager_approvers_rule_check CHECK ((manager_approvers_rule = ANY (ARRAY['ANY'::text, 'ALL'::text])))
);

CREATE TABLE IF NOT EXISTS public.time_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    team_id uuid,
    user_id uuid NOT NULL,
    client_id uuid,
    project_id uuid NOT NULL,
    work_date date NOT NULL,
    minutes integer NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    status text DEFAULT '''draft''::text'::text NOT NULL,
    billable boolean DEFAULT true NOT NULL,
    CONSTRAINT time_entries_minutes_check CHECK (((minutes > 0) AND (minutes <= (24 * 60)) AND ((minutes % 15) = 0))),
    CONSTRAINT time_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
);

COMMENT ON TABLE public.time_entries IS 'Daily time tracking entries';

COMMENT ON COLUMN public.time_entries.minutes IS 'Tracked time in minutes';

CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    slack_id text NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    contract_start_date date,
    carryover_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    team_id uuid,
    CONSTRAINT users_carryover_days_check CHECK ((carryover_days >= 0)),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text, 'hr'::text, 'manager'::text])))
);

CREATE TABLE IF NOT EXISTS public.vacation_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    name text DEFAULT 'Default'::text NOT NULL,
    vacation_days integer DEFAULT 28 NOT NULL,
    bonus_days integer DEFAULT 0 NOT NULL,
    working_days integer DEFAULT 20 NOT NULL,
    carryover_days integer DEFAULT 0 NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vacation_policies_bonus_days_check CHECK ((bonus_days >= 0)),
    CONSTRAINT vacation_policies_carryover_days_check CHECK ((carryover_days >= 0)),
    CONSTRAINT vacation_policies_vacation_days_check CHECK ((vacation_days >= 0)),
    CONSTRAINT vacation_policies_working_days_check CHECK ((working_days > 0))
);

CREATE TABLE IF NOT EXISTS public.vacation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid,
    created_by uuid NOT NULL,
    updated_by uuid,
    type text DEFAULT 'annual_leave'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    days integer NOT NULL,
    working_days integer NOT NULL,
    approved_by_manager boolean DEFAULT false NOT NULL,
    approved_by_hr boolean DEFAULT false NOT NULL,
    user_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vacation_dates_valid CHECK ((end_date >= start_date)),
    CONSTRAINT vacation_requests_days_check CHECK ((days >= 0)),
    CONSTRAINT vacation_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'canceled'::text]))),
    CONSTRAINT vacation_requests_type_check CHECK ((type = ANY (ARRAY['annual_leave'::text, 'bonus_day'::text, 'sick_leave'::text, 'unpaid_leave'::text, 'other'::text]))),
    CONSTRAINT vacation_requests_working_days_check CHECK ((working_days >= 0))
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_report_entries_pkey' AND conrelid = 'public.billing_report_entries'::regclass) THEN
    ALTER TABLE ONLY public.billing_report_entries
        ADD CONSTRAINT billing_report_entries_pkey PRIMARY KEY (report_id, time_entry_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_reports_pkey' AND conrelid = 'public.billing_reports'::regclass) THEN
    ALTER TABLE ONLY public.billing_reports
        ADD CONSTRAINT billing_reports_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_pkey' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_team_name_uniq' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_team_name_uniq UNIQUE (slack_team_id, name);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_pkey' AND conrelid = 'public.holidays'::regclass) THEN
    ALTER TABLE ONLY public.holidays
        ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_client_name_uniq' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_client_name_uniq UNIQUE (client_id, name);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_pkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_step_comments_pkey' AND conrelid = 'public.request_workflow_step_comments'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_step_comments
        ADD CONSTRAINT request_workflow_step_comments_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_steps_pkey' AND conrelid = 'public.request_workflow_steps'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_steps
        ADD CONSTRAINT request_workflow_steps_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slack_teams_name_key' AND conrelid = 'public.slack_teams'::regclass) THEN
    ALTER TABLE ONLY public.slack_teams
        ADD CONSTRAINT slack_teams_name_key UNIQUE (name);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slack_teams_pkey' AND conrelid = 'public.slack_teams'::regclass) THEN
    ALTER TABLE ONLY public.slack_teams
        ADD CONSTRAINT slack_teams_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slack_teams_slack_id_key' AND conrelid = 'public.slack_teams'::regclass) THEN
    ALTER TABLE ONLY public.slack_teams
        ADD CONSTRAINT slack_teams_slack_id_key UNIQUE (slack_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slack_teams_slack_token_key' AND conrelid = 'public.slack_teams'::regclass) THEN
    ALTER TABLE ONLY public.slack_teams
        ADD CONSTRAINT slack_teams_slack_token_key UNIQUE (slack_token);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_name_slack_team_id_unique' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_name_slack_team_id_unique UNIQUE (name, slack_team_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_pkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_pkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pkey' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_slack_id_key' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_slack_id_key UNIQUE (slack_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_policies_pkey' AND conrelid = 'public.vacation_policies'::regclass) THEN
    ALTER TABLE ONLY public.vacation_policies
        ADD CONSTRAINT vacation_policies_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_pkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_clients_name ON public.clients USING btree (slack_team_id, name);

CREATE INDEX IF NOT EXISTS idx_clients_slack_team ON public.clients USING btree (slack_team_id, id);

CREATE INDEX IF NOT EXISTS idx_holidays_team_date ON public.holidays USING btree (slack_team_id, date);

CREATE INDEX IF NOT EXISTS idx_project_teams_team ON public.project_teams USING btree (team_id, slack_team_id, project_id);

CREATE INDEX IF NOT EXISTS idx_project_users_user_team ON public.project_users USING btree (user_id, slack_team_id, project_id);

CREATE INDEX IF NOT EXISTS idx_projects_active ON public.projects USING btree (slack_team_id, id) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON public.projects USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_projects_slack_team_id ON public.projects USING btree (slack_team_id);

CREATE INDEX IF NOT EXISTS idx_slack_teams_created_at ON public.slack_teams USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_step_comments_created_by ON public.request_workflow_step_comments USING btree (created_by);

CREATE INDEX IF NOT EXISTS idx_step_comments_request_id ON public.request_workflow_step_comments USING btree (request_id);

CREATE INDEX IF NOT EXISTS idx_step_comments_step_id ON public.request_workflow_step_comments USING btree (step_id);

CREATE INDEX IF NOT EXISTS idx_team_projects_team ON public.project_teams USING btree (team_id);

CREATE INDEX IF NOT EXISTS idx_teams_slack_team_id ON public.teams USING btree (slack_team_id);

CREATE INDEX IF NOT EXISTS idx_teams_vacation_policy_id ON public.teams USING btree (vacation_policy_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_list_main ON public.time_entries USING btree (slack_team_id, work_date DESC, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_project ON public.time_entries USING btree (slack_team_id, user_id, project_id, work_date) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_time_entries_work_date ON public.time_entries USING btree (slack_team_id, work_date) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_project_name_per_team ON public.projects USING btree (slack_team_id, name) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_user_projects_user ON public.project_users USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_users_is_active ON public.users USING btree (is_active);

CREATE INDEX IF NOT EXISTS idx_users_slack_team_id ON public.users USING btree (slack_team_id);

CREATE INDEX IF NOT EXISTS idx_users_team_lookup ON public.users USING btree (id, slack_team_id, team_id);

CREATE INDEX IF NOT EXISTS idx_vacation_policies_slack_team_id ON public.vacation_policies USING btree (slack_team_id);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_dates ON public.vacation_requests USING btree (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_slack_team_id ON public.vacation_requests USING btree (slack_team_id);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_status ON public.vacation_requests USING btree (status);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_team_id ON public.vacation_requests USING btree (team_id);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_user_id ON public.vacation_requests USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_user_year_status ON public.vacation_requests USING btree (user_id, start_date, status);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_request_id ON public.request_workflow_steps USING btree (request_id);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_step_level ON public.request_workflow_steps USING btree (step_level);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_report_entries_report_id_fkey' AND conrelid = 'public.billing_report_entries'::regclass) THEN
    ALTER TABLE ONLY public.billing_report_entries
        ADD CONSTRAINT billing_report_entries_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.billing_reports(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_report_entries_slack_team_id_fkey' AND conrelid = 'public.billing_report_entries'::regclass) THEN
    ALTER TABLE ONLY public.billing_report_entries
        ADD CONSTRAINT billing_report_entries_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_report_entries_time_entry_id_fkey' AND conrelid = 'public.billing_report_entries'::regclass) THEN
    ALTER TABLE ONLY public.billing_report_entries
        ADD CONSTRAINT billing_report_entries_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_reports_client_id_fkey' AND conrelid = 'public.billing_reports'::regclass) THEN
    ALTER TABLE ONLY public.billing_reports
        ADD CONSTRAINT billing_reports_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_reports_created_by_fkey' AND conrelid = 'public.billing_reports'::regclass) THEN
    ALTER TABLE ONLY public.billing_reports
        ADD CONSTRAINT billing_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_reports_slack_team_id_fkey' AND conrelid = 'public.billing_reports'::regclass) THEN
    ALTER TABLE ONLY public.billing_reports
        ADD CONSTRAINT billing_reports_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_reports_team_id_fkey' AND conrelid = 'public.billing_reports'::regclass) THEN
    ALTER TABLE ONLY public.billing_reports
        ADD CONSTRAINT billing_reports_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_archived_by_fkey' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_created_by_fkey' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_slack_team_id_fkey' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_updated_by_fkey' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE ONLY public.clients
        ADD CONSTRAINT clients_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_created_by_fkey' AND conrelid = 'public.holidays'::regclass) THEN
    ALTER TABLE ONLY public.holidays
        ADD CONSTRAINT holidays_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_slack_team_id_fkey' AND conrelid = 'public.holidays'::regclass) THEN
    ALTER TABLE ONLY public.holidays
        ADD CONSTRAINT holidays_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_updated_by_fkey' AND conrelid = 'public.holidays'::regclass) THEN
    ALTER TABLE ONLY public.holidays
        ADD CONSTRAINT holidays_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_vacation_policy_id_fkey' AND conrelid = 'public.holidays'::regclass) THEN
    ALTER TABLE ONLY public.holidays
        ADD CONSTRAINT holidays_vacation_policy_id_fkey FOREIGN KEY (vacation_policy_id) REFERENCES public.vacation_policies(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_archived_by_fkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_client_id_fkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_created_by_fkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_slack_team_id_fkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_updated_by_fkey' AND conrelid = 'public.projects'::regclass) THEN
    ALTER TABLE ONLY public.projects
        ADD CONSTRAINT projects_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_step_comments_created_by_fkey' AND conrelid = 'public.request_workflow_step_comments'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_step_comments
        ADD CONSTRAINT request_workflow_step_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_step_comments_request_id_fkey' AND conrelid = 'public.request_workflow_step_comments'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_step_comments
        ADD CONSTRAINT request_workflow_step_comments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.vacation_requests(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_step_comments_slack_team_id_fkey' AND conrelid = 'public.request_workflow_step_comments'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_step_comments
        ADD CONSTRAINT request_workflow_step_comments_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_step_comments_step_id_fkey' AND conrelid = 'public.request_workflow_step_comments'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_step_comments
        ADD CONSTRAINT request_workflow_step_comments_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.request_workflow_steps(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_steps_request_id_fkey' AND conrelid = 'public.request_workflow_steps'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_steps
        ADD CONSTRAINT request_workflow_steps_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.vacation_requests(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_workflow_steps_slack_team_id_fkey' AND conrelid = 'public.request_workflow_steps'::regclass) THEN
    ALTER TABLE ONLY public.request_workflow_steps
        ADD CONSTRAINT request_workflow_steps_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_projects_project_id_fkey' AND conrelid = 'public.project_teams'::regclass) THEN
    ALTER TABLE ONLY public.project_teams
        ADD CONSTRAINT team_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_projects_slack_team_id_fkey' AND conrelid = 'public.project_teams'::regclass) THEN
    ALTER TABLE ONLY public.project_teams
        ADD CONSTRAINT team_projects_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_projects_team_id_fkey' AND conrelid = 'public.project_teams'::regclass) THEN
    ALTER TABLE ONLY public.project_teams
        ADD CONSTRAINT team_projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_created_by_fkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_slack_team_id_fkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_updated_by_fkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_vacation_policy_id_fkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE ONLY public.teams
        ADD CONSTRAINT teams_vacation_policy_id_fkey FOREIGN KEY (vacation_policy_id) REFERENCES public.vacation_policies(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_client_id_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_created_by_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_deleted_by_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_project_id_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_slack_team_id_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_team_id_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_updated_by_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_user_id_fkey' AND conrelid = 'public.time_entries'::regclass) THEN
    ALTER TABLE ONLY public.time_entries
        ADD CONSTRAINT time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_projects_project_id_fkey' AND conrelid = 'public.project_users'::regclass) THEN
    ALTER TABLE ONLY public.project_users
        ADD CONSTRAINT user_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_projects_slack_team_id_fkey' AND conrelid = 'public.project_users'::regclass) THEN
    ALTER TABLE ONLY public.project_users
        ADD CONSTRAINT user_projects_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_projects_user_id_fkey' AND conrelid = 'public.project_users'::regclass) THEN
    ALTER TABLE ONLY public.project_users
        ADD CONSTRAINT user_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_slack_team_id_fkey' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_team_id_fkey' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_updated_by_fkey' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_policies_created_by_fkey' AND conrelid = 'public.vacation_policies'::regclass) THEN
    ALTER TABLE ONLY public.vacation_policies
        ADD CONSTRAINT vacation_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_policies_slack_team_id_fkey' AND conrelid = 'public.vacation_policies'::regclass) THEN
    ALTER TABLE ONLY public.vacation_policies
        ADD CONSTRAINT vacation_policies_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_policies_updated_by_fkey' AND conrelid = 'public.vacation_policies'::regclass) THEN
    ALTER TABLE ONLY public.vacation_policies
        ADD CONSTRAINT vacation_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_created_by_fkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_slack_team_id_fkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_slack_team_id_fkey FOREIGN KEY (slack_team_id) REFERENCES public.slack_teams(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_team_id_fkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_updated_by_fkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_user_id_fkey' AND conrelid = 'public.vacation_requests'::regclass) THEN
    ALTER TABLE ONLY public.vacation_requests
        ADD CONSTRAINT vacation_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.request_workflow_step_comments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.request_workflow_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.slack_teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vacation_policies ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vacation_requests ENABLE ROW LEVEL SECURITY;
