import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_DESCRIPTION_LENGTH } from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { IOption } from '@common/types/option.interface';
import { InputCheckboxesBlockBuilder } from '@modules/slack/common/views/builders/input-checkboxes-block.builder';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { TeamModalActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { IRuleFieldValues } from '@modules/slack/tabs/teams/types/rule-field-values.interface';
import { ruleFields } from '@modules/slack/tabs/teams/views/rule-fields';
import { MAX_TEAM_LEADS } from '@modules/teams/constants/team-limits';

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: {
    id: string;
    name: string;
    description?: string;
    managerApprovers: string[] | undefined;
    managerApproversRule: ApprovalRule | null;
    // Its active members.
    members: IOption[];
  } | null;
  rules: TeamRulesChoice;
  // What the rule fields show when the team has its own rules.
  ruleValues: IRuleFieldValues;
  ruleFieldsVersion?: string;
  policies: IOption[];
  managers: IOption[];
  hrUsers: IOption[];
}

export interface ITeamModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
  // The form has the members field: what it holds is the team. False for a
  // team too big to show them all.
  setsMembers?: boolean;
}

// As many as Slack shows chosen in one field. A bigger team is changed
// person by person under People, so the form doesn't drop the rest.
export const MAX_TEAM_MEMBERS = 100;

@Injectable()
export class TeamModalView extends BaseModalView<
  IGetViewParams,
  ITeamModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.TeamFormSubmit;

  protected getTitleText(viewParams: IGetViewParams): string {
    return viewParams.initialData ? 'Edit Team' : 'Create Team';
  }

  public getViewBlocks(params: IGetViewParams): AnyBlock[] {
    const { initialData, errorMessage } = params;

    return [
      {
        type: 'input',
        block_id: 'name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'name',
          initial_value: initialData?.name || '',
        },
        label: {
          type: 'plain_text',
          text: 'Team Name',
        },
      },
      this.getRulesBlock(params.rules),
      ...this.getMembersBlocks(params),
      ...this.getManagerBlocks(params),
      ...(params.rules === TeamRulesChoice.Own
        ? ruleFields({
            values: params.ruleValues,
            policies: params.policies,
            hrUsers: params.hrUsers,
            version: params.ruleFieldsVersion,
          })
        : []),
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          multiline: true,
          action_id: 'description',
          max_length: MAX_DESCRIPTION_LENGTH,
          initial_value: initialData?.description || '',
        },
        label: {
          type: 'plain_text',
          text: 'Description',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private getMembersBlocks({ initialData }: IGetViewParams): AnyBlock[] {
    const members = initialData?.members ?? [];

    if (members.length > MAX_TEAM_MEMBERS) {
      return [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${members.length} members: change them one by one under People (Edit user).`,
            },
          ],
        },
      ];
    }

    return [
      {
        type: 'input',
        block_id: 'members_block',
        optional: true,
        label: { type: 'plain_text', text: 'Members' },
        hint: {
          type: 'plain_text',
          text: "Someone in another team moves to this one. Their time off goes to this team's approvers.",
        },
        element: {
          type: 'multi_external_select',
          action_id: TeamModalActionId.Members,
          placeholder: { type: 'plain_text', text: 'Type a name' },
          min_query_length: 2,
          max_selected_items: MAX_TEAM_MEMBERS,
          ...(members.length
            ? { initial_options: members.map(toPlainTextOption) }
            : {}),
        },
      },
    ];
  }

  // The company rules or the team's own: choosing rebuilds the form
  // (TeamFormRulesHandler) with or without the fields of its own rules.
  private getRulesBlock(rules: TeamRulesChoice): AnyBlock {
    const options: PlainTextOption[] = [
      {
        text: { type: 'plain_text', text: 'Company rules' },
        value: TeamRulesChoice.Company,
      },
      {
        text: { type: 'plain_text', text: 'Its own rules' },
        value: TeamRulesChoice.Own,
      },
    ];

    return {
      type: 'input',
      block_id: 'rules_block',
      dispatch_action: true,
      label: { type: 'plain_text', text: 'Rules' },
      hint: {
        type: 'plain_text',
        text: 'The second approval, who hears of decisions and the vacation policy come from the company rules (Teams → Company rules) or are set for this team.',
      },
      element: {
        type: 'static_select',
        action_id: TeamModalActionId.Rules,
        options,
        initial_option: options.find(({ value }) => value === rules),
      },
    };
  }

  // Anyone active but Finance, searched as you type: a Member chosen here
  // becomes a Manager on save, as the team file makes its leads, so a new
  // workspace, where everyone is a Member, can name its team's approvers.
  private getManagerBlocks(params: IGetViewParams) {
    const chosen = params.initialData?.managerApprovers ?? [];
    const initialOptions = params.managers
      .filter(({ id }) => chosen.includes(id))
      .map(toPlainTextOption);

    return [
      {
        type: 'input',
        block_id: 'manager_approvers_block',
        optional: true,
        label: { type: 'plain_text', text: 'Team approvers' },
        hint: {
          type: 'plain_text',
          text: "They approve this team's time off first. Someone with the Member role becomes a Manager.",
        },
        element: {
          type: 'multi_external_select',
          action_id: TeamModalActionId.Approvers,
          placeholder: { type: 'plain_text', text: 'Type a name' },
          min_query_length: 2,
          max_selected_items: MAX_TEAM_LEADS,
          ...(initialOptions.length ? { initial_options: initialOptions } : {}),
        },
      } as AnyBlock,
      ...InputCheckboxesBlockBuilder.build({
        blockId: 'manager_approvers_rule_block',
        actionId: 'manager_approvers_rule',
        label: "Team approvers' rule",
        options: [{ name: 'All of them must approve', id: ApprovalRule.All }],
        initialValues:
          params.initialData?.managerApproversRule === ApprovalRule.All
            ? [ApprovalRule.All]
            : [],
        optional: true,
      }),
    ];
  }
}
