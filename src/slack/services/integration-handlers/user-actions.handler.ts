import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import { OverflowAction } from '@slack/bolt';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/services/users-tab.service';
import {
  ALL_OPTION_VALUE,
  IUsersTabMetaData,
} from 'src/slack/services/slack-views/tab-views/users-tab-view.service';
import { ButtonAction } from '@slack/bolt/dist/types/actions/block-action';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
export default class UserActionsHandler {
  private readonly logger = new Logger(UserActionsHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly usersTabService: UsersTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case ViewActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      case ViewActionId.ManageUserMenu: {
        await this.handleManageUserMenuAction(payload, user);

        break;
      }
      case ViewActionId.UsersPaginationPrev:
      case ViewActionId.UsersPaginationNext: {
        await this.handlePagination(payload, user);

        break;
      }
      case ViewActionId.FilterUsersByRole: {
        await this.handleFilterByRole(payload, user);

        break;
      }
      case ViewActionId.FilterUsersByTeam: {
        await this.handleFilterByTeam(payload, user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }

  private async handleManageUserMenuAction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn(
        `${ViewActionId.ManageUserMenu} triggered without selected_option`,
      );

      return;
    }

    // e.g. edit_team:team_id
    const [actionType, userId] = selectedValue.split(':');

    switch (actionType) {
      case 'edit_user': {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.EditUser,
          { userId, user },
        );

        break;
      }
      case 'deactivate_user': {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.DeactivateUser,
          { userId, user },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled AdminTeamMenu actionType: ${actionType}`);
      }
    }
  }

  private async handlePagination(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const pageToSet = (payload.actions[0] as ButtonAction)?.value;

    if (!pageToSet) {
      this.logger.warn(
        'Wrong pagination action triggered without selected_option',
      );

      return;
    }

    const metadata = payload.view.private_metadata
      ? (JSON.parse(payload.view.private_metadata) as IUsersTabMetaData)
      : {};

    await this.usersTabService.publish({
      user,
      page: parseInt(pageToSet, 10),
      metadata,
    });
  }

  private async handleFilterByRole(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedRole = (payload.actions[0] as OverflowAction).selected_option
      ?.value as UserRole | undefined | typeof ALL_OPTION_VALUE;

    const metadata = payload.view.private_metadata
      ? (JSON.parse(payload.view.private_metadata) as IUsersTabMetaData)
      : {};

    await this.usersTabService.publish({
      user,
      page: 1,
      metadata: {
        ...metadata,
        filters: {
          ...metadata.filters,
          selectedRole:
            selectedRole !== ALL_OPTION_VALUE ? selectedRole : undefined,
        },
      },
    });
  }

  private async handleFilterByTeam(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedTeamId = (payload.actions[0] as OverflowAction)
      .selected_option?.value;

    const metadata = payload.view.private_metadata
      ? (JSON.parse(payload.view.private_metadata) as IUsersTabMetaData)
      : {};

    await this.usersTabService.publish({
      user,
      page: 1,
      metadata: {
        ...metadata,
        filters: {
          ...metadata.filters,
          selectedTeamId:
            selectedTeamId !== ALL_OPTION_VALUE ? selectedTeamId : undefined,
        },
      },
    });
  }
}
