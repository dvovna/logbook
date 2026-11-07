import { Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, {
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { PeopleTabView } from '@modules/slack/tabs/people/views/people-tab.view';

export type IGetPeopleTabViewParams = IPublishBaseParams;

@Injectable()
export class PeopleTabService extends BaseTabService<never> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly peopleViewService: PeopleTabView,
  ) {
    super(TabId.People);
  }

  protected async getTabView(params: IGetPeopleTabViewParams) {
    const [teamsCount, usersCount] = await Promise.all([
      this.teamsService.count({
        slackTeamId: params.user.slack_team_id,
      }),
      this.usersService.count({
        slackTeamId: params.user.slack_team_id,
      }),
    ]);

    return this.peopleViewService.getView({
      userId: params.user.slack_id,
      userRole: params.user.role,
      usersCount,
      teamsCount,
    });
  }
}
