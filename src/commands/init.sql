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

CREATE INDEX idx_slack_teams_created_at ON slack_teams(created_at);

-- =====================
-- VACATION POLICIES
-- =====================
CREATE TABLE IF NOT EXISTS vacation_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    vacation_days INTEGER NOT NULL,
    working_days INTEGER NOT NULL,
    bonus_days INTEGER DEFAULT 0 NOT NULL,
    carryover_days INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_vacation_policies_slack_team_id ON vacation_policies(slack_team_id);

-- =====================
-- TEAMS
-- =====================
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    vacation_policy_id UUID REFERENCES vacation_policies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    manager_approvers TEXT[] DEFAULT '{}',
    hr_approvers TEXT[] DEFAULT '{}',
    approval_notification_recipients TEXT[] DEFAULT '{}',
    manager_approvers_rule TEXT DEFAULT 'ANY',
    hr_approvers_rule TEXT DEFAULT 'ANY',
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(slack_team_id, name)
);

CREATE INDEX idx_teams_slack_team_id ON teams(slack_team_id);

-- =====================
-- USERS
-- =====================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    team_id UUID REFERENCES teams(id) NOT NULL,
    slack_team_id UUID REFERENCES slack_teams(id) NOT NULL ON DELETE CASCADE,
    slack_id TEXT UNIQUE NOT NULL,
    carryover_days INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    contract_start_date DATE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('member', 'admin', 'hr')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_users_team_id ON users(team_id);
CREATE INDEX idx_users_slack_team_id ON users(slack_team_id);

-- =====================
-- HOLIDAYS
-- =====================
CREATE TABLE IF NOT EXISTS holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_policy_id UUID NOT NULL REFERENCES vacation_policies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    year INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM date)) STORED,
    name TEXT NOT NULL,
    is_company_custom BOOLEAN DEFAULT FALSE NOT NULL,
    is_disabled BOOLEAN DEFAULT FALSE NOT NULL,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL
);

CREATE INDEX idx_holidays_team_date ON holidays(slack_team_id, date);

-- =====================
-- VACATION REQUESTS
-- =====================
CREATE TABLE IF NOT EXISTS vacation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days INTEGER NOT NULL,
    working_days INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'annual_leave' CHECK (type IN ('annual_leave', 'bonus_day', 'sick_leave', 'unpaid_leave', 'other')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL
);

CREATE INDEX idx_vacation_requests_user_id ON vacation_requests(user_id);
CREATE INDEX idx_vacation_requests_team_id ON vacation_requests(team_id);
CREATE INDEX idx_vacation_requests_slack_team_id ON vacation_requests(slack_team_id);
CREATE INDEX idx_vacation_requests_dates ON vacation_requests(start_date, end_date);
CREATE INDEX idx_vacation_requests_status ON vacation_requests(status);
CREATE INDEX idx_vacation_requests_user_year_status
    ON vacation_requests(user_id, start_date, status);

-- =====================
-- VACATION REQUEST WORKFLOW STEPS
-- =====================
CREATE TABLE IF NOT EXISTS vacation_request_workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_request_id UUID NOT NULL REFERENCES vacation_requests(id) ON DELETE CASCADE,
    slack_user_id TEXT NOT NULL,
    step_level INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('approver')),
    step_data JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_workflow_steps_request_id ON vacation_request_workflow_steps(vacation_request_id);

-- =====================
-- VACATION REQUEST STEP COMMENTS
-- =====================
CREATE TABLE IF NOT EXISTS request_workflow_step_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES vacation_requests(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES vacation_request_workflow_steps(id) ON DELETE CASCADE,
    slack_team_id UUID NOT NULL REFERENCES slack_teams(id) ON DELETE CASCADE,
    slack_user_id TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    step_level INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_workflow_step_comments_request_id
    ON request_workflow_step_comments(request_id);
CREATE INDEX idx_step_comments_step_id ON request_workflow_step_comments(step_id);
CREATE INDEX idx_step_comments_user_id ON request_workflow_step_comments(created_by);
