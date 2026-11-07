import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import SlackCommandPromptsService, {
  CsvImport,
} from '@modules/slack-communication/services/slack-command-prompts.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  UsersTabModalName,
  UsersTabService,
} from '@modules/slack/tabs/users/services/users-tab.service';
import { IUsersTabMetaData } from '@modules/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import {
  withAsyncSelectFilter,
  withPagination,
  withResetFilters,
  withSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import UserRole from '@common/enums/user-role.enum';
import { getCheckboxActionValues } from '@modules/slack/common/utils/payload.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UsersTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class UsersTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(UsersTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly usersTabService: UsersTabService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly promptsService: SlackCommandPromptsService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [UsersTabViewActionId.ManageUserMenu]: withMenuAction<
        UsersTabViewActionId,
        [IUserViewModel]
      >(this.handleManageUserMenuAction, this.logger),
      [UsersTabViewActionId.PaginationPrev]: paginationHandler,
      [UsersTabViewActionId.PaginationNext]: paginationHandler,
      [UsersTabViewActionId.FilterUsersByUser]: withAsyncSelectFilter(
        'user',
        this.updateTab,
      ),
      [UsersTabViewActionId.FilterUsersByRole]: withSelectFilter(
        'role',
        this.updateTab,
      ),
      [UsersTabViewActionId.FilterUsersByTeam]: withSelectFilter(
        'teamId',
        this.updateTab,
      ),
      [UsersTabViewActionId.IncludeInactive]: this.handleIncludeInactiveFilter,
      [UsersTabViewActionId.ResetFilters]: withResetFilters(this.updateTab),
      [UsersTabViewActionId.ImportVacations]: (payload, user) =>
        this.showImportInstructions('vacations', payload, user),
      [UsersTabViewActionId.ImportTeams]: (payload, user) =>
        this.showImportInstructions('teams', payload, user),
    };
  }

  // How to import a CSV; the upload itself happens in the Messages tab.
  private showImportInstructions = async (
    kind: CsvImport,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    // The button is shown to admins only, but Slack takes action ids from
    // the client.
    if (user.role !== UserRole.Admin) {
      return;
    }

    await this.slackCommunicationService.openView(
      payload.trigger_id!,
      {
        type: 'modal',
        callback_id: ViewCallbackId.CsvImportInstructions,
        title: {
          type: 'plain_text',
          text: kind === 'vacations' ? 'Import vacations' : 'Import teams',
        },
        close: { type: 'plain_text', text: 'Close' },
        blocks: this.promptsService.getInstructionBlocks(kind),
      },
      user.slack_team_id,
    );
  };

  private updateTab = async (
    metadata: IUsersTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.usersTabService.publish({
      user,
      metadata,
    });
  };

  private handleIncludeInactiveFilter = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const values = getCheckboxActionValues(payload);
    const metadata = parseMetadata<IUsersTabMetaData>(payload);

    const updatedMetadata: IUsersTabMetaData = {
      ...metadata,
      includeInactive: values[0] === YesNoValue.Yes,
    };

    await this.updateTab(updatedMetadata, user);

    await this.usersTabService.publish({
      user,
      metadata: updatedMetadata,
    });
  };

  private handleManageUserMenuAction = async (
    actionType: UsersTabViewActionId,
    userId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case UsersTabViewActionId.ViewVacationUsage: {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.ViewVacationUsage,
          { userId, user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case UsersTabViewActionId.EditUser: {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.EditUser,
          { userId, user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case UsersTabViewActionId.ChangeStatus: {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.ChangeUserStatus,
          { userId, user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Users Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
