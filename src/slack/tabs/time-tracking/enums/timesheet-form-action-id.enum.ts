// The week and day forms' own fields (its cells are keyed by cellKey).
export enum TimesheetFormActionId {
  AddProject = 'timesheet_add_project',
  ShowWeekend = 'timesheet_show_weekend',
  // Submits the week's drafts and rejected entries after saving.
  SubmitWeek = 'timesheet_submit_week_too',
  // The day form's date: choosing one rebuilds the form for that day.
  Day = 'timesheet_day',
  // The day form's comment: the description of what it saves.
  Comment = 'timesheet_comment',
}
