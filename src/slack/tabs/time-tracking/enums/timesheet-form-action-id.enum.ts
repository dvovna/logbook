// The week form's own fields (its cells are keyed by cellKey).
export enum TimesheetFormActionId {
  // Adds a row: a project the viewer may log time on.
  AddProject = 'timesheet_add_project',
  // Shows Saturday and Sunday.
  ShowWeekend = 'timesheet_show_weekend',
  // Submits the week's drafts and rejected entries after saving.
  SubmitWeek = 'timesheet_submit_week_too',
}
