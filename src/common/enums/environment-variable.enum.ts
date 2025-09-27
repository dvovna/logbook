enum EnvironmentVariable {
  Port = 'Port',
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
  MaxPoliciesPerSlackTeam = 'MAX_POLICIES_PER_SLACK_TEAM',
}

export default EnvironmentVariable;
