import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import * as pluralize from 'pluralize';
import { SeparatorComponent } from '@modules/slack/common/views/components/separator';

interface IGetViewParams extends IBaseTabViewParams {
  usersCount: number;
  teamsCount: number;
}

@Injectable()
export class PeopleTabView extends BaseAdminTabView<
  IGetViewParams,
  never
> {
  protected activeTabActionId = AdminNavigationActionId.ManagePeople;
  protected callbackId = ViewCallbackId.PeopleTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*👥 People*';
  }

  protected getContentBlocks(
    { usersCount, teamsCount }: IGetViewParams,
  ): AnyBlock[] {
    return [
      { type: 'section', text: { type: 'plain_text', text: 'Manage users and teams within the organization.' } },
      ...SeparatorComponent.getBlocks(),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*👤 Users*\n*${usersCount}* ${pluralize('user', usersCount)} across all teams`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Manage' },
          action_id: AdminNavigationActionId.ManageUsers,
        },
      },
      { type: 'section', text: { type: 'plain_text', text: '\n' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*:office: Teams*\n*${teamsCount}* active ${teamsCount === 1 ? 'team' : 'teams'}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Manage' },
          action_id: AdminNavigationActionId.ManageTeams,
        },
      },
    ];
  }
}
