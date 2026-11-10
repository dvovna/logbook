import { CLIENT_EDITOR_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';
import IClientViewModel from '@modules/clients/types/client.interface';
import ClientsService from '@modules/clients/services/clients.service';
import {
  ClientsTabModalName,
  ClientsTabService,
} from '@modules/slack/tabs/clients/services/clients-tab.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ChangeClientStatus,
  type: 'view_submission',
  allowedRoles: CLIENT_EDITOR_ROLES,
})
export class ChangeClientStatusFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IClientViewModel
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly clientsService: ClientsService,
    private readonly clientsTabService: ClientsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    return SlackViewResponseFactory.update(
      await this.clientsTabService.getModalView(
        ClientsTabModalName.ChangeClientStatus,
        {
          clientId: meta.id,
          user,
          errorMessage,
          pageMetadata: meta.pageMetadata!,
        },
      ),
    );
  }

  protected async onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IClientViewModel> {
    const client = await this.clientsService.findOneWithValidation({
      id: meta.id,
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    const updateParams = client.archived_at
      ? {
          archivedAt: null,
          archivedBy: null,
        }
      : {
          archivedAt: new Date().toISOString(),
          archivedBy: user.id,
        };

    const updatedClient = await this.clientsService.update(
      {
        id: client.id,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      },
      updateParams,
      user,
    );

    this.tabNavigationService.navigate(TabId.Clients, {
      user,
      notice: `✅ ${updatedClient.name} ${updatedClient.archived_at ? 'archived' : 'restored'}.`,
    });

    return updatedClient;
  }
}
