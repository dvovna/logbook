import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import {
  ruleFieldsConfig,
  ruleFieldsSchema,
  selectedOptionSchema,
} from '@modules/slack/tabs/teams/parsers/rule-field-parts';

const companyRulesSchema = z.object({
  policy: selectedOptionSchema,
  ...ruleFieldsSchema,
});

export interface ICompanyRulesFormViewData {
  policy: ISelectedOption;
  hr_approvers?: ISelectedOption[];
  hr_approvers_rule?: ISelectedOption<ApprovalRule>[];
  approval_notification_recipients?: string[];
}

@Injectable()
export default class CompanyRulesViewValuesParser extends BaseValuesParser<ICompanyRulesFormViewData> {
  public constructor() {
    super(companyRulesSchema, ruleFieldsConfig);
  }
}
