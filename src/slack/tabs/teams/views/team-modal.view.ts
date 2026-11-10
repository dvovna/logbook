import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_DESCRIPTION_LENGTH } from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { SlackMultiStaticSelectView } from '@modules/slack/common/views/components/slack-multi-static-select.view';
import { IOption } from '@common/types/option.interface';
import { InputCheckboxesBlockBuilder } from '@modules/slack/common/views/builders/input-checkboxes-block.builder';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { TeamModalActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: {
    id: string;
    name: string;
    description?: string;
    vacation_policy_id: string | null;
    managerApprovers: string[] | undefined;
    hrApprovers: string[] | undefined;
    approvalNotificationRecipients: string[] | undefined;
    managerApproversRule: ApprovalRule | null;
    hrApproversRule: ApprovalRule | null;
    // Its active members.
    members: IOption[];
  } | null;
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

export const NO_POLICY_VALUE = 'NO_POLICY';

// As many as Slack shows chosen in one field. A bigger team is changed
// person by person under People, so the form doesn't drop the rest.
export const MAX_TEAM_MEMBERS = 100;

const NO_POLICY_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'No Policy' },
  value: NO_POLICY_VALUE,
};

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
    const { initialData, policies, errorMessage } = params;

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
      this.getPolicyBlock(policies, initialData?.vacation_policy_id),
      ...this.getMembersBlocks(params),
      ...this.getApproverBlocks(params),
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

  private getApproverBlocks(params: IGetViewParams) {
    return [
      ...SlackMultiStaticSelectView.getView({
        blockId: 'manager_approvers_block',
        actionId: 'manager_approvers',
        label: 'Level 1: managers',
        hint: 'People with the Manager or Admin role. Give someone that role under People to choose them here.',
        maxSelectedItems: 5,
        emptyText:
          'Level 1 approvers are people with the Manager or Admin role. Nobody has it yet: change a role under People first.',
        optional: true,
        placeholder: 'Manager Approvers',
        options: params.managers,
        initialValues: params.initialData?.managerApprovers,
      }),
      ...InputCheckboxesBlockBuilder.build({
        blockId: 'manager_approvers_rule_block',
        actionId: 'manager_approvers_rule',
        label: 'Level 1 rule',
        options: [
          { name: 'All listed approvers must approve', id: ApprovalRule.All },
        ],
        initialValues:
          params.initialData?.managerApproversRule === ApprovalRule.All
            ? [ApprovalRule.All]
            : [],
        optional: true,
      }),
      ...SlackMultiStaticSelectView.getView({
        blockId: 'hr_approvers_block',
        actionId: 'hr_approvers',
        maxSelectedItems: 5,
        label: 'Level 2: HR',
        hint: 'People with the HR or Admin role. Give someone that role under People to choose them here.',
        emptyText:
          'Level 2 approvers are people with the HR or Admin role. Nobody has it yet: change a role under People first.',
        optional: true,
        placeholder: 'HR Approvers',
        options: params.hrUsers,
        initialValues: params.initialData?.hrApprovers,
      }),
      ...InputCheckboxesBlockBuilder.build({
        blockId: 'hr_approvers_rule_block',
        actionId: 'hr_approvers_rule',
        label: 'Level 2 rule',
        options: [
          { name: 'All listed approvers must approve', id: ApprovalRule.All },
        ],
        initialValues:
          params.initialData?.hrApproversRule === ApprovalRule.All
            ? [ApprovalRule.All]
            : [],
        optional: true,
      }),
      {
        type: 'input',
        block_id: 'approval_notification_recipients_block',
        optional: true,
        element: {
          type: 'multi_users_select',
          action_id: 'approval_notification_recipients',
          max_selected_items: 5,
          placeholder: { type: 'plain_text', text: 'Select users to notify' },
          initial_users: params.initialData?.approvalNotificationRecipients,
        },
        label: {
          type: 'plain_text',
          text: 'Approval Notification Recipients',
        },
      },
    ];
  }

  private getPolicyBlock(
    policies: { id: string; name: string }[],
    teamPolicyId?: string | null,
  ) {
    const policyOptions = policies.map((policy) => ({
      text: {
        type: 'plain_text',
        text: policy.name,
      },
      value: policy.id,
    }));

    const options = [NO_POLICY_OPTION, ...policyOptions];

    const selectedPolicyId = teamPolicyId || NO_POLICY_VALUE;
    const selectedPolicy = options.find(
      (policy) => policy.value === selectedPolicyId,
    );

    return {
      type: 'input',
      block_id: 'policy_block',
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'policy',
        placeholder: {
          type: 'plain_text',
          text: 'Select a vacation policy',
        },
        options,
        ...(selectedPolicy && { initial_option: selectedPolicy }),
      },
      label: {
        type: 'plain_text',
        text: 'Vacation Policy',
      },
    };
  }
}
