import { Injectable } from '@nestjs/common';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import { ClientsTabView, IClientsTabMetaData } from '@modules/slack/tabs/clients/views/clients-tab.view';
import ClientsService from '@modules/clients/services/clients.service';
import { ClientModalView } from '@modules/slack/tabs/clients/views/client-modal.view';

interface IClientModalViewParams extends IOpenModalBaseParams<string> {
  clientId: string;
}

export enum ClientsTabModalName {
  CreateClient = 'CreateClient',
  UpdateClient = 'UpdateClient',
  ChangeClientStatus = 'ChangeClientStatus',
}

interface IGetClientsTabViewParams extends IPublishBaseParams {
  metadata?: IClientsTabMetaData;
}

const CLIENTS_TAB_PAGE_SIZE = 10;

type ClientsTabModalViewResolversMapType = {
  [ClientsTabModalName.CreateClient]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [ClientsTabModalName.UpdateClient]: (
    params: IClientModalViewParams,
  ) => Promise<View>;
  [ClientsTabModalName.ChangeClientStatus]: (
    params: IClientModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class ClientsTabService extends BaseTabService<ClientsTabModalViewResolversMapType> {
  public constructor(
    private readonly clientsService: ClientsService,
    private readonly clientModalView: ClientModalView,
    private readonly clientsTabView: ClientsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Clients, {
      [ClientsTabModalName.CreateClient]: (params) =>
        this.getCreateClientModalView(params),
      [ClientsTabModalName.UpdateClient]: (params) =>
        this.getUpdateClientModalView(params),
      [ClientsTabModalName.ChangeClientStatus]: (params) =>
        this.getChangeClientStatusModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetClientsTabViewParams) {
    const [clientsData] = await Promise.all([
      this.clientsService.search({
        filters: {
          slackTeamId: user.slack_team_id,
          includeArchived: metadata?.includeArchived,
        },
        orderBy: ['name:asc'],
        page: metadata.page,
        pageSize: CLIENTS_TAB_PAGE_SIZE,
      }),
    ]);

    return await this.clientsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        clientsData,
      },
      metadata,
    );
  }

  private async getCreateClientModalView({
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    return this.clientModalView.getView(
      { errorMessage },
      { pageMetadata },
    );
  }

  private async getUpdateClientModalView({
    clientId,
    user,
    pageMetadata,
    errorMessage,
  }: IClientModalViewParams) {
    const client = await this.clientsService.findOneWithValidation({
      id: clientId,
      slackTeamId: user.slack_team_id,
    });

    return this.clientModalView.getView(
      {
        initialData: client,
        errorMessage,
      },
      { id: client.id, pageMetadata },
    );
  }

  private async getChangeClientStatusModalView({
    clientId,
    user,
    errorMessage,
    pageMetadata,
  }: IClientModalViewParams) {
    const client = await this.clientsService.findOneWithValidation({
      id: clientId,
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ChangeClientStatus,
        title: `${client.archived_at ? 'Restore' : 'Archive'} Client`,
        message: `The client *${client.name}* will be ${client.archived_at ? 'restored' : 'archived'}.`,
        errorMessage,
      },
      {
        id: client.id,
        pageMetadata,
      },
    );
  }
}
