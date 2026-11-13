import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import {
  COMPANY_RULES_SAVED,
  CompanyRulesSavedEvent,
} from '@modules/teams/events/company-rules.events';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  namesSomeoneNew,
  writeNamingApprovers,
} from '@modules/users/utils/approvers-changed';
import { TransactionService } from 'src/database/transaction.service';

export interface ICompanyRulesParams {
  hrApprovers: string[];
  hrApproversRule: ApprovalRule;
  notificationRecipients: string[];
  vacationPolicyId: string | null;
}

// The rule set that teams follow unless they keep their own, and that people
// in no team follow. It writes what it is given; callers check the roles of
// the approvers and that the policy is the workspace's.
@Injectable()
export class CompanyRulesService {
  public constructor(
    private readonly ruleSetsRepository: RuleSetsRepository,
    private readonly transactions: TransactionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public get(slackTeamId: string): Promise<IRuleSetViewModel> {
    return this.ruleSetsRepository.ensureDefault(slackTeamId);
  }

  // Level 2 naming someone it didn't may start the requests that waited for
  // anyone who can approve them (writeNamingApprovers).
  public async update(
    slackTeamId: string,
    params: ICompanyRulesParams,
    user: IUserViewModel,
  ): Promise<IRuleSetViewModel> {
    const ruleSet = await this.get(slackTeamId);
    const saved = await writeNamingApprovers(
      { transactions: this.transactions, eventEmitter: this.eventEmitter },
      slackTeamId,
      namesSomeoneNew(ruleSet.hr_approvers, params.hrApprovers),
      () =>
        this.ruleSetsRepository.update(
          { id: ruleSet.id, slack_team_id: slackTeamId },
          {
            hr_approvers: params.hrApprovers,
            hr_approvers_rule: params.hrApproversRule,
            approval_notification_recipients: params.notificationRecipients,
            vacation_policy_id: params.vacationPolicyId,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          },
        ),
    );

    // What shows the company rules elsewhere (an open team file preview)
    // follows them.
    this.eventEmitter.emit(
      COMPANY_RULES_SAVED,
      new CompanyRulesSavedEvent(slackTeamId),
    );

    return saved;
  }

  // A new policy goes into company rules that name none, so the first one a
  // workspace makes applies to everyone without a second step. Not a save of
  // the rules by someone: `updated_by` stays, which the setup checklist reads.
  public async adoptPolicyIfNone(
    slackTeamId: string,
    policyId: string,
  ): Promise<boolean> {
    await this.get(slackTeamId);
    const adopted = await this.ruleSetsRepository.updateMany(
      {
        slack_team_id: slackTeamId,
        is_default: true,
        vacation_policy_id: null,
      },
      { vacation_policy_id: policyId },
    );

    if (adopted.length) {
      this.eventEmitter.emit(
        COMPANY_RULES_SAVED,
        new CompanyRulesSavedEvent(slackTeamId),
      );
    }

    return adopted.length > 0;
  }

  public async usesPolicy(
    policyId: string,
    slackTeamId: string,
  ): Promise<boolean> {
    const count = await this.ruleSetsRepository.count({
      slack_team_id: slackTeamId,
      vacation_policy_id: policyId,
    });

    return count > 0;
  }
}
