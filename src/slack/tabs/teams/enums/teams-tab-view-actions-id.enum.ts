export enum TeamsTabViewActionId {
  AddTeam = 'add_team',
  CompanyRules = 'company_rules',
  TeamFile = 'team_file',
  EditTeam = 'edit_team',
  DeleteTeam = 'delete_team',
  ManageTeamMenu = 'manage_team_menu',
  PaginationPrev = 'teams_pagination_prev',
  PaginationNext = 'teams_pagination_next',
}

export enum TeamModalActionId {
  // People searched as you type.
  Members = 'members',
  // Company rules or the team's own: choosing rebuilds the form.
  Rules = 'rules',
  // The team's approvers, searched as you type: anyone who may approve or
  // become a Manager by it.
  Approvers = 'manager_approvers',
}
