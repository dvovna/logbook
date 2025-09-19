import { Injectable } from '@nestjs/common';
import BaseTabService, {
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { ConfigService } from '@nestjs/config';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';
import {
  IVacationHistoryTabMetadata,
  VacationHistoryTabView,
} from 'src/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';

export type IPublishVacationsHistoryTabViewParams =
  IPublishBaseParams<IVacationHistoryTabMetadata>;

const VACATION_HISTORY_PAGE_SIZE = 5;

@Injectable()
export class VacationHistoryTabService extends BaseTabService<
  never,
  IPublishVacationsHistoryTabViewParams
> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationsHistoryTabView: VacationHistoryTabView,
    private readonly config: ConfigService,
  ) {
    super(TabId.VacationsHistory);
  }

  protected async getTabView(params: IPublishVacationsHistoryTabViewParams) {
    const requests = await this.getVacationRequests(params);

    const minYear = this.config.getOrThrow<number>(EnvironmentVariable.MinYear);
    const maxYear = this.config.getOrThrow<number>(EnvironmentVariable.MaxYear);

    return this.vacationsHistoryTabView.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
        requests,
        years: Array.from(
          { length: maxYear - minYear + 1 },
          (_, index) => index + minYear,
        ),
      },
      params.metadata,
    );
  }

  private async getVacationRequests({
    user,
    metadata = {},
  }: IPublishVacationsHistoryTabViewParams) {
    const { type, year } = metadata?.filters ?? {};

    return this.vacationRequestsService.search({
      page: metadata.page,
      pageSize: VACATION_HISTORY_PAGE_SIZE,
      orderBy: ['start_date:desc'],
      filters: {
        slackTeamId: user.slack_team_id,
        userId: user.id,
        status: VacationRequestStatus.Approved,
        ...(year && { year }),
        ...(type && { type }),
      },
    });
  }
}
