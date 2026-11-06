export enum ProjectsTabViewActionId {
  AddProject = 'add_project',
  EditProject = 'edit_project',
  ManageProjectAssignments = 'manage_project_assignments',

  ArchiveProject = 'archive_project',
  ManageProjectMenu = 'manage_project_menu',
  PaginationPrev = 'projects_pagination_prev',
  PaginationNext = 'projects_pagination_next',

  FindProjectByName = 'find_project_by_name',
  FilterByStatus = 'filter_projects_by_status',
  FilterByBillable = 'filter_projects_by_billable',
  ResetFilters = 'reset_projects_filters',
  IncludeArchivedProjects = 'include_archived_projects',
}
