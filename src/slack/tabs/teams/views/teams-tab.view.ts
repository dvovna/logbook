import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { ISearchResult } from '@common/types/pagination.types';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';

// "Ada, Bob, Carl and 2 more", for the cards of a list.
const listNames = (names: string[], shown = 5) => {
  const listed = names.slice(0, shown).map(escapeMrkdwn).join(', ');

  return names.length > shown
    ? `${listed} and ${names.length - shown} more`
    : listed;
};

interface IGetViewParams extends IBaseTabViewParams {
  teamsData: ISearchResult<ITeamViewModel>;
  // Active members' names by team ID.
  membersByTeam: Record<string, string[]>;
}

export interface ITeamsTabMetaData {
  page?: number;
}

@Injectable()
export class TeamsTabView extends BaseAdminTabView<
  IGetViewParams,
  ITeamsTabMetaData
> {
  protected callbackId = ViewCallbackId.TeamsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManagePeople;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '🏢 *Teams Management*\n\nManage team membership, assign vacation policies, \nand configure approvers/notification recipients.';
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Team' },
      action_id: TeamsTabViewActionId.AddTeam,
    };
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManagePeople);
  }

  protected getContentBlocks({ teamsData, membersByTeam }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const listBlocks = PaginatedListView.getBlocks<ITeamViewModel>({
      itemsData: teamsData,
      getItemBlocks: (item: ITeamViewModel) =>
        this.getTeamListItemBlocks(item, membersByTeam[item.id] ?? []),
      prevPageActionId: TeamsTabViewActionId.PaginationPrev,
      nextPageActionId: TeamsTabViewActionId.PaginationNext,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getTeamListItemBlocks(
    team: ITeamViewModel,
    members: string[],
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const updatedAt = formatDate(team.updated_at);
    const createdAt = formatDate(team.created_at);

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${escapeMrkdwn(team.name)}*\n` +
            `Vacation Policy: ${team.vacation_policy?.name || '-'}\n` +
            `Description: ${team.description || '-'}\n` +
            `Approvers: ${this.describeApprovers(team)}\n` +
            `Members: ${members.length ? `${members.length} (${listNames(members)})` : 'none yet'}\n` +
            `Created: ${createdAt}\n` +
            `Updated: ${updatedAt}`,
        },
      ],
      accessory: {
        type: 'overflow',
        action_id: TeamsTabViewActionId.ManageTeamMenu,
        options: [
          {
            text: { type: 'plain_text', text: 'Edit Team' },
            value: `${TeamsTabViewActionId.EditTeam}:${team.id}`,
          },
          {
            text: {
              type: 'plain_text',
              text: 'Delete Team',
            },
            value: `${TeamsTabViewActionId.DeleteTeam}:${team.id}`,
          },
        ],
      },
    });

    blocks.push(...Divider.getBlocks());

    return blocks;
  }

  // "Managers <@U1> (any one), then HR <@U2> (all)". Without any, a request
  // goes to HR or the admins (VacationRequestProcessingService).
  private describeApprovers(team: ITeamViewModel) {
    const level = (
      label: string,
      approvers: string[] | null,
      rule: ApprovalRule,
    ) =>
      approvers?.length
        ? `${label} ${approvers.map((id) => `<@${id}>`).join(', ')} (${rule === ApprovalRule.All ? 'all' : 'any one'})`
        : null;
    const levels = [
      level('managers', team.manager_approvers, team.manager_approvers_rule),
      level('HR', team.hr_approvers, team.hr_approvers_rule),
    ].filter((text): text is string => !!text);

    return levels.length
      ? levels.join(', then ')
      : 'none, so requests go to HR or the admins';
  }
}
