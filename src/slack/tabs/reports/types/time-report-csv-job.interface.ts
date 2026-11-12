import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import { ITimeReportFilters } from 'src/time-entries/types/time-report.types';

// What the time report on show was made with: enough to make it again.
export interface ITimeReportCsvParams {
  groupBy: TimeReportGrouping;
  fromDate: string;
  toDate: string;
  filters: ITimeReportFilters;
}

// The job that sends a time report's CSV: who asked, and the report's
// parameters. The file is made again from them on a retry, in the scope
// the person has then.
export interface ITimeReportCsvJob extends ITimeReportCsvParams {
  slackTeamId: string;
  userId: string;
}
