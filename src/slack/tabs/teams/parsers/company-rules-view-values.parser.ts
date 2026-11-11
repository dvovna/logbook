import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

const option = z.object({ value: z.string(), text: z.string() });

const companyRulesSchema = z.object({
  policy: option,
  hr_approvers: z.array(option).optional(),
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
});

export interface ICompanyRulesFormViewData {
  policy: ISelectedOption;
  hr_approvers?: ISelectedOption[];
  hr_approvers_rule?: ISelectedOption<ApprovalRule>[];
  approval_notification_recipients?: string[];
}

// The fields have the team form's block ids and action ids (ruleFields).
@Injectable()
export default class CompanyRulesViewValuesParser extends BaseValuesParser<ICompanyRulesFormViewData> {
  public constructor() {
    super(companyRulesSchema, {
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
    });
  }
}
