import UserRole from '@common/enums/user-role.enum';
import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import {
  ClientsTabModalName,
  ClientsTabService,
} from '@modules/slack/tabs/clients/services/clients-tab.service';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import { IClientsTabMetaData } from '@modules/slack/tabs/clients/views/clients-tab.view';
import { getCheckboxActionValues } from '@modules/slack/common/utils/payload.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ClientsTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class ClientsTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(ClientsTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly clientsTabService: ClientsTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [ClientsTabViewActionId.AddClient]: this.handleAddClient,
      [ClientsTabViewActionId.ManageClientMenu]: withMenuAction<
        ClientsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageClientMenuAction, this.logger),
      [ClientsTabViewActionId.IncludeArchivedClients]:
        this.handleIncludeArchivedClientsFilter,
      [ClientsTabViewActionId.PaginationPrev]: paginationHandler,
      [ClientsTabViewActionId.PaginationNext]: paginationHandler,
    };
  }

  private updateTab = async (
    metadata: IClientsTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.clientsTabService.publish({
      user,
      metadata,
    });
  };

  private handleAddClient = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.clientsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ClientsTabModalName.CreateClient,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleIncludeArchivedClientsFilter = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const values = getCheckboxActionValues(payload);
    const metadata = parseMetadata<IClientsTabMetaData>(payload);

    const updatedMetadata: IClientsTabMetaData = {
      ...metadata,
      includeArchived: values[0] === YesNoValue.Yes,
    };

    await this.updateTab(updatedMetadata, user);
  };

  private handleManageClientMenuAction = async (
    actionType: ClientsTabViewActionId,
    clientId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case ClientsTabViewActionId.EditClient: {
        await this.clientsTabService.openModal(
          payload.trigger_id || user.slack_id,
          ClientsTabModalName.UpdateClient,
          { user, clientId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case ClientsTabViewActionId.ArchiveClient: {
        await this.clientsTabService.openModal(
          payload.trigger_id || user.slack_id,
          ClientsTabModalName.ChangeClientStatus,
          { user, clientId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Client Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
