import { Injectable } from '@nestjs/common';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamsService from 'src/teams/teams.service';
import { UsersService } from 'src/users/users.service';
import {
  IUsersTabMetaData,
  UsersManagementTabViewService,
} from 'src/slack/services/slack-views/tab-views/users-management-tab-view.service';
import UserRole from 'src/common/enums/user-role.enum';

export interface IUsersTabViewFilters {
  selectedTeamId?: string;
  selectedRole?: UserRole;
}

@Injectable()
export class UsersTabService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly manageUsersViewService: UsersManagementTabViewService,
  ) {}

  public async publishManageUsersTab(
    user: IUserViewModel,
    page = 1,
    metadata?: IUsersTabMetaData,
  ) {
    const [users, teams] = await Promise.all([
      this.usersService.search({
        filters: {
          slackTeamId: user.slack_team_id,
          ...(metadata?.filters?.selectedTeamId
            ? { teamId: metadata?.filters.selectedTeamId }
            : {}),
          ...(metadata?.filters?.selectedRole
            ? { role: metadata?.filters.selectedRole }
            : {}),
        },
        sortBy: 'name',
        sortOrder: 'asc',
        page,
      }),
      this.teamsService.findMany({ slackTeamId: user.slack_team_id }),
    ]);

    await this.slackCommunicationService.publishView(
      this.manageUsersViewService.getView(
        {
          userId: user.slack_id,
          teams,
          users,
        },
        metadata,
      ),
      user.slack_team_id,
    );
  }
}
