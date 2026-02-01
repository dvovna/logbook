import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';
import ClientModalViewValuesParser, {
  IClientFormViewData,
} from '@modules/slack/tabs/clients/parsers/client-modal-view-values.parser';
import { ClientModalView, IClientModalViewMetadata } from '@modules/slack/tabs/clients/views/client-modal.view';
import IClientViewModel from '@modules/clients/types/client.interface';
import ClientsService from '@modules/clients/services/clients.service';
import { ClientsTabModalName, ClientsTabService } from '@modules/slack/tabs/clients/services/clients-tab.service';
import { IClientsTabMetaData } from '@modules/slack/tabs/clients/views/clients-tab.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ClientFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ClientFormSubmitHandler extends BaseModalFormSubmitHandler<
  IClientModalViewMetadata,
  IClientFormViewData,
  IClientViewModel
> {
  public constructor(
    private readonly clientModalView: ClientModalView,
    private readonly clientsService: ClientsService,
    private readonly teamsTabService: ClientsTabService,
    private readonly tabNavigationService: TabNavigationService,
    clientModalViewValuesParser: ClientModalViewValuesParser,
  ) {
    super(clientModalViewValuesParser);
  }

  protected successResponse(
    team: IClientViewModel,
    user: IUserViewModel,
    metadata: IClientModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IClientsTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Clients, {
      user,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.clientModalView.getSuccessView(
        `✅ Client '${team.name}' was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: IClientFormViewData,
    metadata: IClientModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(
    data: IClientFormViewData,
    user: IUserViewModel,
  ): Promise<IClientViewModel> {
    return this.clientsService.create(
      {
        name: data.name,
        description: data.description,
        slackTeamId: user.slack_team_id,
      },
      user,
    );
  }

  private update(
    id: string,
    data: IClientFormViewData,
    user: IUserViewModel,
  ): Promise<IClientViewModel> {
    return this.clientsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        name: data.name,
        description: data.description,
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IClientFormViewData,
    metadata: IClientModalViewMetadata,
    user: IUserViewModel,
  ) {
    const updatedModalView = await this.getModalView(
      metadata,
      errorMessage,
      user,
    );

    return SlackViewResponseFactory.update(updatedModalView);
  }

  private async getModalView(
    metadata: IClientModalViewMetadata,
    errorMessage: string,
    user: IUserViewModel,
  ) {
    if (metadata.id) {
      return this.teamsTabService.getModalView(ClientsTabModalName.UpdateClient, {
        clientId: metadata.id,
        errorMessage,
        user,
        pageMetadata: metadata.pageMetadata,
      });
    }

    return this.teamsTabService.getModalView(ClientsTabModalName.CreateClient, {
      errorMessage,
      user,
      pageMetadata: metadata.pageMetadata,
    });
  }
}
