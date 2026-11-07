import {
  ListItem,
  detail,
} from '@modules/slack/common/views/components/list-item.view';
import { listNames } from '@modules/slack/common/utils/list.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { ISearchResult } from '@common/types/pagination.types';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';

interface IGetViewParams extends IBaseTabViewParams {
  teamsData: ISearchResult<ITeamViewModel>;
  // Active members' names by team ID.
  membersByTeam: Record<string, string[]>;
}

export interface ITeamsTabMetaData {
  page?: number;
}

@Injectable()
export class TeamsTabView extends BaseTabView<
  IGetViewParams,
  ITeamsTabMetaData
> {
  protected callbackId = ViewCallbackId.TeamsTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
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
    return ListItem.getBlocks({
      title: team.name,
      details: [
        detail(
          'Vacation Policy',
          team.vacation_policy?.name
            ? escapeMrkdwn(team.vacation_policy.name)
            : 'none',
        ),
        detail(
          'Description',
          team.description && escapeMrkdwn(team.description),
        ),
        detail('Approvers', this.describeApprovers(team)),
        detail(
          'Members',
          members.length
            ? `${members.length} (${listNames(members)})`
            : 'none yet',
        ),
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
            text: { type: 'plain_text', text: 'Delete Team' },
            value: `${TeamsTabViewActionId.DeleteTeam}:${team.id}`,
          },
        ],
      },
    });
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
