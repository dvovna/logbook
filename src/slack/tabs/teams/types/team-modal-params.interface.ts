import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';

export interface INewTeamModalViewParams extends IOpenModalBaseParams<string> {
  rules?: TeamRulesChoice;
  ruleFieldsVersion?: string;
}

// People a form shows as chosen, so they stay in the lists.
export interface IChosenApprovers {
  managerApprovers?: string[];
  hrApprovers?: string[];
}
