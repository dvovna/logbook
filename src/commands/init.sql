-- Database schema for the bot.
-- Mirrors src/common/types/database.types.ts (generated from the live Supabase DB).
-- Idempotent: safe to run against an existing database (`yarn db:init`).
--
-- Audit columns (created_by / updated_by) that are NOT NULL use the default
-- NO ACTION rule: a user that authored rows can't be hard-deleted on its own
-- (users are deactivated instead), but deleting a slack_teams row still
-- cascades through every table because the check runs at statement end.

-- =====================
-- SLACK TEAMS
-- =====================
CREATE TABLE IF NOT EXISTS slack_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    slack_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_teams_created_at ON slack_teams(created_at);

-- =====================
-- USERS
-- (users.team_id FK is added after the teams table is created)
-- =====================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    team_id UUID,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    slack_id TEXT NOT NULL UNIQUE,
    carryover_days INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    contract_start_date DATE,
    role TEXT NOT NULL CHECK (role IN ('member', 'admin', 'hr', 'manager')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_slack_team_id ON users(slack_team_id);

-- =====================
-- VACATION POLICIES
-- =====================
CREATE TABLE IF NOT EXISTS vacation_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vacation_days INTEGER NOT NULL,
    working_days INTEGER NOT NULL,
    bonus_days INTEGER NOT NULL DEFAULT 0,
    carryover_days INTEGER NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID CONSTRAINT team_settings_created_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID CONSTRAINT team_settings_updated_by_fkey REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vacation_policies_slack_team_id ON vacation_policies(slack_team_id);

-- =====================
-- TEAMS
-- =====================
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    vacation_policy_id UUID REFERENCES vacation_policies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    manager_approvers TEXT[] DEFAULT '{}',
    hr_approvers TEXT[] DEFAULT '{}',
    approval_notification_recipients TEXT[] DEFAULT '{}',
    manager_approvers_rule TEXT NOT NULL DEFAULT 'ANY',
    hr_approvers_rule TEXT NOT NULL DEFAULT 'ANY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (slack_team_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_slack_team_id ON teams(slack_team_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_team_id_fkey'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_team_id_fkey
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    END IF;
END
$$;

-- =====================
-- HOLIDAYS
-- =====================
CREATE TABLE IF NOT EXISTS holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_policy_id UUID NOT NULL REFERENCES vacation_policies(id) ON DELETE CASCADE,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM date)::INTEGER) STORED,
    name TEXT NOT NULL,
    country_code TEXT,
    is_company_custom BOOLEAN NOT NULL DEFAULT FALSE,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_holidays_team_date ON holidays(slack_team_id, date);
CREATE INDEX IF NOT EXISTS idx_holidays_vacation_policy_id ON holidays(vacation_policy_id);

-- =====================
-- VACATION REQUESTS
-- =====================
CREATE TABLE IF NOT EXISTS vacation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL CONSTRAINT vacations_user_id_fkey REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days INTEGER NOT NULL,
    working_days INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'annual_leave'
        CHECK (type IN ('annual_leave', 'bonus_day', 'sick_leave', 'unpaid_leave', 'other')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
    user_comment TEXT,
    -- legacy columns, not used by the code (approval state lives in request_workflow_steps)
    approved_by_manager BOOLEAN,
    approved_by_hr BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID NOT NULL CONSTRAINT vacations_created_by_fkey REFERENCES users(id),
    updated_by UUID NOT NULL CONSTRAINT vacations_updated_by_fkey REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vacation_requests_user_id ON vacation_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_team_id ON vacation_requests(team_id);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_slack_team_id ON vacation_requests(slack_team_id);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_dates ON vacation_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_status ON vacation_requests(status);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_user_year_status
    ON vacation_requests(user_id, start_date, status);

-- =====================
-- REQUEST WORKFLOW STEPS
-- =====================
CREATE TABLE IF NOT EXISTS request_workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL
        CONSTRAINT vacation_request_workflow_steps_vacation_request_id_fkey
        REFERENCES vacation_requests(id) ON DELETE CASCADE,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    slack_user_id TEXT,
    step_level INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('approver')),
    step_data JSONB NOT NULL DEFAULT '{}'::JSONB,
    slack_channel_id TEXT,
    slack_message_ts TEXT,
    processed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_request_id ON request_workflow_steps(request_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_slack_team_id ON request_workflow_steps(slack_team_id);

-- =====================
-- REQUEST WORKFLOW STEP COMMENTS
-- =====================
CREATE TABLE IF NOT EXISTS request_workflow_step_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL CONSTRAINT fk_request REFERENCES vacation_requests(id) ON DELETE CASCADE,
    step_id UUID NOT NULL CONSTRAINT fk_step REFERENCES request_workflow_steps(id) ON DELETE CASCADE,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    slack_user_id TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    step_level INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_workflow_step_comments_request_id
    ON request_workflow_step_comments(request_id);
CREATE INDEX IF NOT EXISTS idx_step_comments_step_id ON request_workflow_step_comments(step_id);
CREATE INDEX IF NOT EXISTS idx_step_comments_user_id ON request_workflow_step_comments(created_by);

-- =====================
-- ROW LEVEL SECURITY
-- The app uses the service-role key, which bypasses RLS. Enabling RLS without
-- policies blocks access through the public anon key (slack_teams holds bot tokens).
-- =====================
ALTER TABLE slack_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_workflow_step_comments ENABLE ROW LEVEL SECURITY;
