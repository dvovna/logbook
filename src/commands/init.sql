-- =======================================
-- INITIAL SCHEMA SETUP (transaction-safe)
-- =======================================

BEGIN;

-- =======================================
-- EXTENSIONS
-- =======================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =======================================
-- DROP TABLES IN DEPENDENCY ORDER (reverse)
-- =======================================
DROP TABLE IF EXISTS
    public.request_workflow_step_comments,
    public.request_workflow_steps,
    public.vacation_requests,
    public.holidays,
    public.teams,
    public.vacation_policies,
    public.users,
    public.slack_teams
    CASCADE;

-- =======================================
-- SLACK TEAMS
-- =======================================
CREATE TABLE public.slack_teams
(
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE,
    slack_id    text NOT NULL UNIQUE,
    slack_token text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_slack_teams_created_at ON public.slack_teams (created_at);


-- =======================================
-- USERS
-- =======================================
CREATE TABLE public.users
(
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id       uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    name                text,
    email               text NOT NULL UNIQUE,
    slack_id            text NOT NULL UNIQUE,
    role                text NOT NULL CHECK (role IN ('member','admin','hr','manager')),
    is_active           boolean NOT NULL DEFAULT true,
    contract_start_date date,
    carryover_days      integer NOT NULL DEFAULT 0 CHECK (carryover_days >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE INDEX idx_users_slack_team_id ON public.users (slack_team_id);
CREATE INDEX idx_users_is_active ON public.users (is_active);


-- =======================================
-- VACATION POLICIES
-- =======================================
CREATE TABLE public.vacation_policies
(
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id  uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    name           text NOT NULL DEFAULT 'Default',
    vacation_days  integer NOT NULL DEFAULT 28 CHECK (vacation_days >= 0),
    bonus_days     integer NOT NULL DEFAULT 0 CHECK (bonus_days >= 0),
    working_days   integer NOT NULL DEFAULT 20 CHECK (working_days > 0),
    carryover_days integer NOT NULL DEFAULT 0 CHECK (carryover_days >= 0),
    created_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,
    updated_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vacation_policies_slack_team_id ON public.vacation_policies (slack_team_id);


-- =======================================
-- TEAMS
-- =======================================
CREATE TABLE public.teams
(
    id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id                    uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    name                             text NOT NULL,
    description                      text,
    vacation_policy_id               uuid REFERENCES public.vacation_policies (id) ON DELETE SET NULL,
    created_by                       uuid REFERENCES public.users (id) ON DELETE SET NULL,
    updated_by                       uuid REFERENCES public.users (id) ON DELETE SET NULL,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    updated_at                       timestamptz NOT NULL DEFAULT now(),
    manager_approvers                uuid[] DEFAULT '{}',
    hr_approvers                     uuid[] DEFAULT '{}',
    approval_notification_recipients text[] DEFAULT '{}',
    manager_approvers_rule           text NOT NULL DEFAULT 'any' CHECK (manager_approvers_rule IN ('any', 'all')),
    hr_approvers_rule                text NOT NULL DEFAULT 'any' CHECK (hr_approvers_rule IN ('any', 'all'))
);

CREATE INDEX idx_teams_slack_team_id ON public.teams (slack_team_id);
CREATE INDEX idx_teams_vacation_policy_id ON public.teams (vacation_policy_id);


-- =======================================
-- LINK USERS TO TEAMS
-- (after both exist)
-- =======================================
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams (id) ON DELETE SET NULL;


-- =======================================
-- HOLIDAYS
-- =======================================
CREATE TABLE public.holidays
(
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_policy_id uuid NOT NULL REFERENCES public.vacation_policies (id) ON DELETE CASCADE,
    slack_team_id      uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    name               text NOT NULL,
    date               date NOT NULL,
    year               integer NOT NULL,
    is_company_custom  boolean NOT NULL DEFAULT false,
    is_disabled        boolean NOT NULL DEFAULT false,
    country_code       text,
    created_by         uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    updated_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_holidays_team_date ON public.holidays (slack_team_id, date);


-- =======================================
-- VACATION REQUESTS
-- =======================================
CREATE TABLE public.vacation_requests
(
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id       uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    team_id             uuid REFERENCES public.teams (id) ON DELETE SET NULL,
    created_by          uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    updated_by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
    type                text NOT NULL DEFAULT 'annual_leave' CHECK (type IN ('annual_leave','bonus_day','sick_leave','unpaid_leave','other')),
    status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','canceled')),
    start_date          date NOT NULL,
    end_date            date NOT NULL,
    days                integer NOT NULL CHECK (days >= 0),
    working_days        integer NOT NULL CHECK (working_days >= 0),
    approved_by_manager boolean NOT NULL DEFAULT false,
    approved_by_hr      boolean NOT NULL DEFAULT false,
    user_comment        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vacation_dates_valid CHECK (end_date >= start_date)
);

CREATE INDEX idx_vacation_requests_user_id ON public.vacation_requests (user_id);
CREATE INDEX idx_vacation_requests_team_id ON public.vacation_requests (team_id);
CREATE INDEX idx_vacation_requests_slack_team_id ON public.vacation_requests (slack_team_id);
CREATE INDEX idx_vacation_requests_dates ON public.vacation_requests (start_date, end_date);
CREATE INDEX idx_vacation_requests_status ON public.vacation_requests (status);
CREATE INDEX idx_vacation_requests_user_year_status ON public.vacation_requests (user_id, start_date, status);


-- =======================================
-- REQUEST WORKFLOW STEPS
-- =======================================
CREATE TABLE public.request_workflow_steps
(
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id       uuid NOT NULL REFERENCES public.vacation_requests (id) ON DELETE CASCADE,
    slack_team_id    uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    step_type        text NOT NULL CHECK (step_type IN ('approver','notifier')),
    step_level       smallint NOT NULL CHECK (step_level > 0),
    step_data        jsonb NOT NULL DEFAULT '{}'::jsonb,
    slack_user_id    text,
    slack_message_ts text,
    slack_channel_id text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    processed_at     timestamptz,
    completed_at     timestamptz
);

CREATE INDEX idx_workflow_steps_request_id ON public.request_workflow_steps (request_id);
CREATE INDEX idx_workflow_steps_step_level ON public.request_workflow_steps (step_level);


-- =======================================
-- REQUEST STEP COMMENTS
-- =======================================
CREATE TABLE public.request_workflow_step_comments
(
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id    uuid NOT NULL REFERENCES public.vacation_requests (id) ON DELETE CASCADE,
    step_id       uuid NOT NULL REFERENCES public.request_workflow_steps (id) ON DELETE CASCADE,
    slack_team_id uuid NOT NULL REFERENCES public.slack_teams (id) ON DELETE CASCADE,
    slack_user_id text NOT NULL,
    created_by    uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    step_level    smallint NOT NULL,
    comment       text NOT NULL CHECK (length(trim(comment)) > 0),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_step_comments_request_id ON public.request_workflow_step_comments (request_id);
CREATE INDEX idx_step_comments_step_id ON public.request_workflow_step_comments (step_id);
CREATE INDEX idx_step_comments_created_by ON public.request_workflow_step_comments (created_by);


COMMIT;
