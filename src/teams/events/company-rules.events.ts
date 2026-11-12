export const COMPANY_RULES_SAVED = 'company_rules.saved';

export class CompanyRulesSavedEvent {
  public constructor(public readonly slackTeamId: string) {}
}
