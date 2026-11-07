import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { ISearchResult } from '@common/types/pagination.types';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import IClientViewModel from '@modules/clients/types/client.interface';
import { IncludeArchivedButtonView } from '@modules/slack/common/views/components/include-archvied-button.view';

interface IGetViewParams extends IBaseTabViewParams {
  clientsData: ISearchResult<IClientViewModel>;
}

export interface IClientsTabMetaData {
  page?: number;
  includeArchived?: boolean;
}

@Injectable()
export class ClientsTabView extends BaseTabView<
  IGetViewParams,
  IClientsTabMetaData
> {
  protected callbackId = ViewCallbackId.ClientsTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getTabTitle() {
    return "🏢 *Clients Management*\n\nManage your organization's clients and their details.";
  }

  protected getTitleAccessory({
    userRole,
  }: IGetViewParams): SectionBlockAccessory | null {
    if (
      !this.slackActionPermissionsService.can(
        userRole,
        ClientsTabViewActionId.AddClient,
      )
    ) {
      return null;
    }

    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Client' },
      action_id: ClientsTabViewActionId.AddClient,
    };
  }

  protected getContentBlocks(
    { clientsData, userRole }: IGetViewParams,
    { includeArchived }: IClientsTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push(
      IncludeArchivedButtonView.getView({
        actionId: ClientsTabViewActionId.IncludeArchivedClients,
        title: 'Include Archived Clients',
        includeArchived,
      }),
    );

    const listBlocks = PaginatedListView.getBlocks<IClientViewModel>({
      itemsData: clientsData,
      getItemBlocks: (client) =>
        this.getClientListItemBlocks(
          client,
          this.slackActionPermissionsService.can(
            userRole,
            ClientsTabViewActionId.ManageClientMenu,
          ),
        ),
      prevPageActionId: ClientsTabViewActionId.PaginationPrev,
      nextPageActionId: ClientsTabViewActionId.PaginationNext,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getClientListItemBlocks = (
    client: IClientViewModel,
    canManage: boolean,
  ): AnyBlock[] => {
    const blocks: AnyBlock[] = [];

    const updatedAt = formatDate(client.updated_at);
    const createdAt = formatDate(client.created_at);
    const menu = {
      type: 'overflow',
      action_id: ClientsTabViewActionId.ManageClientMenu,
      options: [
        ...(!client.archived_at
          ? ([
              {
                text: { type: 'plain_text', text: 'Edit Client' },
                value: `${ClientsTabViewActionId.EditClient}:${client.id}`,
              },
            ] as const)
          : []),
        {
          text: {
            type: 'plain_text',
            text: `${client.archived_at ? 'Restore' : 'Archive'} Client`,
          },
          value: `${ClientsTabViewActionId.ArchiveClient}:${client.id}`,
        },
      ],
    } as const;

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${client.name}*\n` +
            `Description: ${client.description || '-'}\n` +
            `Created: ${createdAt}\n` +
            `Updated: ${updatedAt}`,
        },
      ],
      ...(canManage ? { accessory: menu } : {}),
    });

    blocks.push(...Divider.getBlocks());

    return blocks;
  };
}
