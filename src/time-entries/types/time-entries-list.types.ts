import { IOption } from '@modules/slack/common/types/option.interface';
import { ITotalCount } from '@common/types/list.types';

export interface ITimeEntryListItem {
  id: string;
  work_date: string;
  created_at: string;
  user_name: string;
  project_name: string;
  client_name: string;
  minutes: number;
  description: string;
}

export interface ITimeEntriesListFilters {
  fromDate: string;
  toDate: string;
  project: IOption;
  user: IOption;
}

export type ITimeEntryListItemWithTotalCount = ITimeEntryListItem & ITotalCount;

export interface ITimeEntryListData {
  items: ITimeEntryListItem[];
  totalCount: number;
}
