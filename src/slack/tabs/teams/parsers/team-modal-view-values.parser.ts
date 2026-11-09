import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_TEAM_NAME_LENGTH = 50;

const teamFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Team name is required')
    .max(
      MAX_TEAM_NAME_LENGTH,
      `Team name must be at most ${MAX_TEAM_NAME_LENGTH} characters`,
    ),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, 'Description must be at most 200 characters')
    .optional(),
  policy: z
    .object({
      value: z.string(),
      text: z.string(),
    })
    .optional(),
  manager_approvers: z
    .array(
      z.object({
        value: z.string(),
        text: z.string(),
      }),
    )
    .optional(),
  manager_approvers_rule: z
    .array(
      z.object({
        value: z.enum(Object.values(ApprovalRule)),
        text: z.string(),
      }),
    )
    .optional(),
  hr_approvers: z
    .array(
      z.object({
        value: z.string(),
        text: z.string(),
      }),
    )
    .optional(),
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
  members: z
    .array(z.object({ value: z.string().uuid(), text: z.string() }))
    .optional(),
});

export interface ITeamFormViewData {
  name: string;
  policy?: ISelectedOption;
  description?: string;
  manager_approvers?: ISelectedOption[];
  manager_approvers_rule?: ISelectedOption<ApprovalRule>[];
  hr_approvers?: ISelectedOption[];
  hr_approvers_rule?: ISelectedOption<ApprovalRule>[];
  approval_notification_recipients?: string[];
  // Not on a form for a team too big to show its members.
  members?: ISelectedOption[];
}

@Injectable()
export default class TeamModalViewValuesParser extends BaseValuesParser<ITeamFormViewData> {
  public constructor() {
    super(teamFormSchema, {
      name: {
        blockId: 'name_block',
        type: ViewFieldType.Text,
      },
      description: {
        blockId: 'description_block',
        type: ViewFieldType.Text,
      },
      policy: {
        blockId: 'policy_block',
        type: ViewFieldType.Select,
      },
      manager_approvers: {
        blockId: 'manager_approvers_block',
        type: ViewFieldType.MultiSelect,
      },
      manager_approvers_rule: {
        blockId: 'manager_approvers_rule_block',
        type: ViewFieldType.Checkboxes,
      },
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
      members: {
        blockId: 'members_block',
        type: ViewFieldType.MultiSelect,
      },
    });
  }
}
