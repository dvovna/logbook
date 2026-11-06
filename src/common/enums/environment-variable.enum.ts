enum EnvironmentVariable {
  Port = 'PORT',
  SupabaseUrl = 'SUPABASE_URL',
  SupabaseServiceRoleKey = 'SUPABASE_SERVICE_ROLE_KEY',
  SlackClientId = 'SLACK_CLIENT_ID',
  SlackClientSecret = 'SLACK_CLIENT_SECRET',
  SlackSignInSecret = 'SLACK_SIGN_IN_SECRET',
  SlackRedirectUri = 'SLACK_REDIRECT_URI',
  MinYear = 'MIN_YEAR',
  MaxYear = 'MAX_YEAR',
  MaxRequestsPerUser = 'MAX_REQUESTS_PER_USER',
  MaxPendingRequestsPerUser = 'MAX_PENDING_REQUESTS_PER_USER',
  MaxTeamsPerSlackTeam = 'MAX_TEAMS_PER_SLACK_TEAM',
  MaxClientsPerSlackTeam = 'MAX_CLIENTS_PER_SLACK_TEAM',
  MaxProjectsPerSlackTeam = 'MAX_PROJECTS_PER_SLACK_TEAM',
  MaxPoliciesPerSlackTeam = 'MAX_POLICIES_PER_SLACK_TEAM',
  MaxCompanyHolidaysPerCompanyPerYear = 'MAX_COMPANY_HOLIDAYS_PER_COMPANY_PER_YEAR',
}

export default EnvironmentVariable;
