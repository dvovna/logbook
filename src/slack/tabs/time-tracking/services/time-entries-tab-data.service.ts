import { Injectable } from '@nestjs/common';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

export interface ITimeEntriesTabFilters {
  projectId?: string;
  userId?: string;
  billable?: YesNoValue;
  fromDate?: string;
  toDate?: string;
}

export const TIME_ENTRIES_TAB_PAGE_SIZE = 10;

@Injectable()
export class TimeEntriesTabDataService {
  constructor(private readonly timeEntriesListQuery: TimeEntriesListQuery) {}

  async getTimeEntriesTabData(params: {
    slackTeamId: string;
    page?: number;
    filters?: ITimeEntriesTabFilters;
  }) {
    const { slackTeamId, page = 1, filters } = params;

    return this.timeEntriesListQuery.execute({
      slackTeamId,
      page,
      pageSize: TIME_ENTRIES_TAB_PAGE_SIZE,
      projectId: filters?.projectId,
      userId: filters?.userId,
      billable:
        filters?.billable !== undefined
          ? filters.billable === YesNoValue.Yes
          : undefined,
      fromDate: filters?.fromDate,
      toDate: filters?.toDate,
    });
  }
}
