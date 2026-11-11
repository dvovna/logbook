import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
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
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
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
  companyRules: IRuleSetViewModel;
  // What each team follows, by team ID.
  rulesByTeam: Record<string, IEffectiveTeamRules>;
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
    return `*${SCREENS[ScreenId.Teams].title}*\nEach team's members, approvers and vacation policy.`;
  }

  protected getContentBlocks({
    teamsData,
    membersByTeam,
    companyRules,
    rulesByTeam,
  }: IGetViewParams): AnyBlock[] {
    const blocks: AnyBlock[] = [
      {
        type: 'actions',
        block_id: 'teams_actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '➕ Add Team' },
            action_id: TeamsTabViewActionId.AddTeam,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '⚙️ Company rules' },
            action_id: TeamsTabViewActionId.CompanyRules,
          },
        ],
      },
    ];

    const listBlocks = PaginatedListView.getBlocks<ITeamViewModel>({
      itemsData: teamsData,
      getItemBlocks: (item: ITeamViewModel) =>
        this.getTeamListItemBlocks(
          item,
          membersByTeam[item.id] ?? [],
          rulesByTeam[item.id],
          companyRules,
        ),
      prevPageActionId: TeamsTabViewActionId.PaginationPrev,
      nextPageActionId: TeamsTabViewActionId.PaginationNext,
      emptyText:
        "_No teams yet._ A team's approvers decide its people's time off, under its vacation policy.",
      emptyAction: {
        text: 'Create a team',
        actionId: TeamsTabViewActionId.AddTeam,
      },
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getTeamListItemBlocks(
    team: ITeamViewModel,
    members: string[],
    rules: IEffectiveTeamRules,
    companyRules: IRuleSetViewModel,
  ): AnyBlock[] {
    const policy = [companyRules.vacation_policy, team.vacation_policy].find(
      (candidate) => candidate?.id === rules.vacationPolicyId,
    );

    return ListItem.getBlocks({
      title: team.name,
      details: [
        detail('Rules', rules.followsCompanyRules ? 'company' : 'own'),
        detail(
          'Vacation Policy',
          policy?.name ? escapeMrkdwn(policy.name) : 'none',
        ),
        detail(
          'Description',
          team.description && escapeMrkdwn(team.description),
        ),
        detail('Approvers', this.describeApprovers(rules)),
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
  private describeApprovers(rules: IEffectiveTeamRules) {
    const level = (label: string, approvers: string[], rule: ApprovalRule) =>
      approvers.length
        ? `${label} ${approvers.map((id) => `<@${id}>`).join(', ')} (${rule === ApprovalRule.All ? 'all' : 'any one'})`
        : null;
    const levels = [
      level('managers', rules.managerApprovers, rules.managerApproversRule),
      level('HR', rules.hrApprovers, rules.hrApproversRule),
    ].filter((text): text is string => !!text);

    return levels.length
      ? levels.join(', then ')
      : 'none, so requests go to HR or the admins';
  }
}
