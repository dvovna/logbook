import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { IOption } from '@common/types/option.interface';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { SlackMultiStaticSelectView } from '@modules/slack/common/views/components/slack-multi-static-select.view';
import { InputCheckboxesBlockBuilder } from '@modules/slack/common/views/builders/input-checkboxes-block.builder';
import { versionedBlockId } from '@modules/slack/services/slack-view-values.parser';
import { NO_POLICY_VALUE } from '@modules/slack/tabs/teams/constants/no-policy';
import { IRuleFieldValues } from '@modules/slack/tabs/teams/types/rule-field-values.interface';

export interface IRuleFieldsParams {
  values: IRuleFieldValues;
  policies: IOption[];
  hrUsers: IOption[];
  // Set when the form was rebuilt with other values: new block_ids, since
  // Slack keeps what a field with the same block_id holds on views.update.
  version?: string;
}

const NO_POLICY_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'No Policy' },
  value: NO_POLICY_VALUE,
};

// The fields of the rules a team may keep for itself and the company rules
// have: vacation policy, level 2 and who hears of decisions. The parsers
// read them by these block_ids (with or without a `:version`).
export const ruleFields = ({
  values,
  policies,
  hrUsers,
  version,
}: IRuleFieldsParams): AnyBlock[] => {
  const blockId = (id: string) =>
    version ? versionedBlockId(id, version) : id;

  return [
    policyBlock(policies, values.vacationPolicyId, blockId('policy_block')),
    ...SlackMultiStaticSelectView.getView({
      blockId: blockId('hr_approvers_block'),
      actionId: 'hr_approvers',
      maxSelectedItems: 5,
      label: 'Second approval (HR)',
      hint: "After the team's approvers. People with the HR or Admin role. Leave it empty to let the team's approvers decide alone.",
      emptyText:
        'The second approval is for people with the HR or Admin role. Nobody has it yet: change a role under People first, or leave it out.',
      optional: true,
      placeholder: 'HR Approvers',
      options: hrUsers,
      initialValues: values.hrApprovers,
    }),
    ...InputCheckboxesBlockBuilder.build({
      blockId: blockId('hr_approvers_rule_block'),
      actionId: 'hr_approvers_rule',
      label: "Second approval's rule",
      options: [{ name: 'All of them must approve', id: ApprovalRule.All }],
      initialValues:
        values.hrApproversRule === ApprovalRule.All ? [ApprovalRule.All] : [],
      optional: true,
    }),
    {
      type: 'input',
      block_id: blockId('approval_notification_recipients_block'),
      optional: true,
      element: {
        type: 'multi_users_select',
        action_id: 'approval_notification_recipients',
        max_selected_items: 5,
        placeholder: { type: 'plain_text', text: 'Select users to notify' },
        ...(values.notificationRecipients.length
          ? { initial_users: values.notificationRecipients }
          : {}),
      },
      label: {
        type: 'plain_text',
        text: 'Who hears of decisions',
      },
    },
  ];
};

// Required, with "No Policy" as a choice: an optional field would add
// Slack's own "Clear selection", which means the same.
const policyBlock = (
  policies: IOption[],
  policyId: string | null,
  blockId: string,
): AnyBlock => {
  const options = [
    NO_POLICY_OPTION,
    ...policies.map((policy): PlainTextOption => ({
      text: { type: 'plain_text', text: policy.name },
      value: policy.id,
    })),
  ];
  const selected = options.find(
    ({ value }) => value === (policyId || NO_POLICY_VALUE),
  );

  return {
    type: 'input',
    block_id: blockId,
    element: {
      type: 'static_select',
      action_id: 'policy',
      placeholder: { type: 'plain_text', text: 'Select a vacation policy' },
      options,
      ...(selected && { initial_option: selected }),
    },
    label: { type: 'plain_text', text: 'Vacation Policy' },
  };
};
