import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { IOption } from '@common/types/option.interface';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IRuleFieldValues } from '@modules/slack/tabs/teams/types/rule-field-values.interface';
import { ruleFields } from '@modules/slack/tabs/teams/views/rule-fields';

interface IGetViewParams extends IBaseModalViewParams {
  values: IRuleFieldValues;
  policies: IOption[];
  hrUsers: IOption[];
}

export interface ICompanyRulesModalMetadata {
  pageMetadata: string;
  // Set when the modal was opened from Home, which a save re-renders.
  openedFrom?: TabId;
}

@Injectable()
export class CompanyRulesModalView extends BaseModalView<
  IGetViewParams,
  ICompanyRulesModalMetadata
> {
  protected defaultCallbackId = ViewCallbackId.CompanyRulesSubmit;

  protected getTitleText(): string {
    return 'Company rules';
  }

  public getViewBlocks({
    values,
    policies,
    hrUsers,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    return [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Teams that follow the company rules, and people in no team, use these. Level 1 always comes from the team.',
          },
        ],
      },
      ...ruleFields({ values, policies, hrUsers }),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
