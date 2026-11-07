import { IOption } from '@common/types/option.interface';
import { ITotalCount } from '@common/types/list.types';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';

export interface ITimeEntryListItem {
  id: string;
  work_date: string;
  created_at: string;
  user_name: string;
  project_name: string;
  client_name: string;
  minutes: number;
  description: string;
  user_id: string;
  status: TimeEntryStatus;
}

export interface ITimeEntriesListFilters {
  fromDate?: string;
  toDate?: string;
  project?: IOption;
  user?: IOption;
}

export type ITimeEntryListItemWithTotalCount = ITimeEntryListItem & ITotalCount;

export interface ITimeEntryListData {
  items: ITimeEntryListItem[];
  totalCount: number;
}
