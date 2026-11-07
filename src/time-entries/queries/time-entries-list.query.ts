import { RpcFunctionName } from '@common/enums/rpc-function-name';
import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/database/supabase.service';
import {
  ITimeEntryListData,
  ITimeEntryListItemWithTotalCount,
} from 'src/time-entries/types/time-entries-list.types';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

interface IExecuteParams {
  slackTeamId: string;
  pageSize: number;
  page: number;
  userId?: string;
  billable?: boolean;
  projectId?: string;
  clientId?: string;
  teamId?: string;
  fromDate?: string;
  toDate?: string;
  status?: TimeEntryStatus;
  // Entries of these teams only.
  teamIds?: string[];
  // Without this user's entries.
  excludeUserId?: string;
}

@Injectable()
export class TimeEntriesListQuery {
  constructor(private readonly supabase: SupabaseService) {}

  async execute(params: IExecuteParams): Promise<ITimeEntryListData> {
    const { data, error } = await this.supabase
      .getClient()
      .rpc(RpcFunctionName.GetTimeEntriesList, {
        p_slack_team_id: params.slackTeamId,
        p_limit: params.pageSize,
        p_offset: (params.page - 1) * params.pageSize,
        p_user_id: params.userId,
        p_project_id: params.projectId,
        p_billable: params.billable,
        p_client_id: params.clientId,
        p_team_id: params.teamId,
        p_from_work_date: params.fromDate,
        p_to_work_date: params.toDate,
        p_status: params.status,
        p_team_ids: params.teamIds,
        p_exclude_user_id: params.excludeUserId,
      });

    if (error) {
      throw new Error(
        `${RpcFunctionName.GetTimeEntriesList} failed: ${error.message}`,
      );
    }

    const items = (data ?? []) as ITimeEntryListItemWithTotalCount[];
    const totalCount = items[0]?.total_count ?? 0;

    return {
      items,
      totalCount,
    };
  }
}
