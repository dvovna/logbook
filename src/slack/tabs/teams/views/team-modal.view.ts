import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { MAX_DESCRIPTION_LENGTH } from 'src/slack/tabs/teams/parsers/team-modal-view-values.parser';
import BaseModalView, {
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { SlackMultiStaticSelectView } from 'src/slack/common/views/components/slack-multi-static-select.view';
import { IOption } from 'src/slack/common/types/option.interface';
import { SlackInputCheckboxesView } from 'src/slack/common/views/components/slack-input-checkboxes.view';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';

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
  } | null;
  policies: IOption[];
  managers: IOption[];
  hrUsers: IOption[];
}

export interface ITeamModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

export const NO_POLICY_VALUE = 'NO_POLICY';

const NO_POLICY_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'No Policy' },
  value: NO_POLICY_VALUE,
};

@Injectable()
export class TeamModalView extends BaseModalView<
  IGetViewParams,
  ITeamModalViewMetadata
> {
  protected callbackId = ViewCallbackId.TeamFormSubmit;

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

  private getApproverBlocks(params: IGetViewParams) {
    return [
      ...SlackMultiStaticSelectView.getView({
        blockId: 'manager_approvers_block',
        actionId: 'manager_approvers',
        label: 'Managers (Level 1 Approvers)',
        maxSelectedItems: 5,
        emptyText:
          'No user with Manager role available. Please assign some first.',
        optional: true,
        placeholder: 'Manager Approvers',
        options: params.managers,
        initialValues: params.initialData?.managerApprovers,
      }),
      ...SlackInputCheckboxesView.getView({
        blockId: 'manager_approvers_rule_block',
        actionId: 'manager_approvers_rule',
        label: 'Managers Approval Rule',
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
        label: 'HR (Level 2 Approvers)',
        emptyText: 'No user with HR role available. Please assign some first.',
        optional: true,
        placeholder: 'HR Approvers',
        options: params.hrUsers,
        initialValues: params.initialData?.hrApprovers,
      }),
      ...SlackInputCheckboxesView.getView({
        blockId: 'hr_approvers_rule_block',
        actionId: 'hr_approvers_rule',
        label: 'HR Approval Rule',
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

    const selectedPolicy = options.find(
      (policy) => policy.value === teamPolicyId || NO_POLICY_VALUE,
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
