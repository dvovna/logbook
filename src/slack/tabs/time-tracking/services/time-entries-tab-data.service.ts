import { Injectable } from '@nestjs/common';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

export interface ITimeEntriesTabFilters {
  projectId?: string;
  userId?: string;
  billable?: YesNoValue;
  fromDate?: string;
  toDate?: string;
}

export const TIME_ENTRIES_TAB_PAGE_SIZE = 10;

// The minutes of each of `days` over `entries`.
export const totalsByDay = (
  days: string[],
  entries: { work_date: string; minutes: number }[],
): Record<string, number> => {
  const totals: Record<string, number> = Object.fromEntries(
    days.map((day) => [day, 0]),
  );

  for (const entry of entries) {
    if (entry.work_date in totals) {
      totals[entry.work_date] += entry.minutes;
    }
  }

  return totals;
};

@Injectable()
export class TimeEntriesTabDataService {
  constructor(
    private readonly timeEntriesListQuery: TimeEntriesListQuery,
    private readonly timeEntriesService: TimeEntriesService,
  ) {}

  // The minutes of each of `days` ('2026-06-17'), over every entry the list
  // has on that day, on any page.
  async getDayTotals(params: {
    slackTeamId: string;
    days: string[];
    filters?: ITimeEntriesTabFilters;
  }): Promise<Record<string, number>> {
    const { slackTeamId, days, filters } = params;

    if (!days.length) {
      return {};
    }

    const sorted = [...days].sort();
    const entries = await this.timeEntriesService.findMany({
      slackTeamId,
      userId: filters?.userId,
      projectId: filters?.projectId,
      dateFrom: sorted[0],
      dateTo: sorted[sorted.length - 1],
    });

    return totalsByDay(days, entries);
  }

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
