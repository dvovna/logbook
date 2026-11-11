import { z } from 'zod';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

// The rule fields of the team form and the company rules form (ruleFields).
export const selectedOptionSchema = z.object({
  value: z.string(),
  text: z.string(),
});

export const ruleFieldsSchema = {
  hr_approvers: z.array(selectedOptionSchema).optional(),
  hr_approvers_rule: z
    .array(
      z.object({
        value: z.enum(Object.values(ApprovalRule)),
        text: z.string(),
      }),
    )
    .optional(),
  approval_notification_recipients: z
    .array(z.string().min(1, 'User ID cannot be empty'))
    .optional(),
};

export const ruleFieldsConfig = {
  policy: { blockId: 'policy_block', type: ViewFieldType.Select },
  hr_approvers: {
    blockId: 'hr_approvers_block',
    type: ViewFieldType.MultiSelect,
  },
  hr_approvers_rule: {
    blockId: 'hr_approvers_rule_block',
    type: ViewFieldType.Checkboxes,
  },
  approval_notification_recipients: {
    blockId: 'approval_notification_recipients_block',
    type: ViewFieldType.MultiUserSelect,
  },
};
