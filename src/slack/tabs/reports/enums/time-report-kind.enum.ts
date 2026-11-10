import { TimeReportGrouping } from 'src/time-entries/services/time-report.service';

// What the time report form asks for: time by client, project, person or
// team (TimeReportGrouping), or who hasn't sent their time for approval.
export enum TimeReportKind {
  Client = 'client',
  Project = 'project',
  Person = 'person',
  Team = 'team',
  Missing = 'missing',
}

const GROUPINGS: Record<TimeReportKind, TimeReportGrouping | null> = {
  [TimeReportKind.Client]: TimeReportGrouping.Client,
  [TimeReportKind.Project]: TimeReportGrouping.Project,
  [TimeReportKind.Person]: TimeReportGrouping.Person,
  [TimeReportKind.Team]: TimeReportGrouping.Team,
  [TimeReportKind.Missing]: null,
};

export const groupingOf = (kind: TimeReportKind) => GROUPINGS[kind];

export const TIME_REPORT_KIND_NAMES: Record<TimeReportKind, string> = {
  [TimeReportKind.Client]: 'Time by client',
  [TimeReportKind.Project]: 'Time by project',
  [TimeReportKind.Person]: 'Time by person',
  [TimeReportKind.Team]: 'Time by team',
  [TimeReportKind.Missing]: "Who hasn't submitted",
};

// The optional filters of the time report form, by their action_id (which
// the parser reads them by). Project and Person are external selects, which
// SlackOptionsController fills within what the viewer may see.
export enum TimeReportFilterId {
  Client = 'report_client',
  Project = 'report_project',
  Person = 'report_person',
}
