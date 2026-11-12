import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  APPROVERS_CHANGED,
  ApproversChangedEvent,
} from '@modules/users/events/users.events';
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

  // Level 2 naming someone it didn't runs in a transaction with the job that
  // starts the requests waiting for anyone who can approve them
  // (APPROVERS_CHANGED, emitAsync).
  public async update(
    slackTeamId: string,
    params: ICompanyRulesParams,
    user: IUserViewModel,
  ): Promise<IRuleSetViewModel> {
    const ruleSet = await this.get(slackTeamId);
    const write = () =>
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
      );

    if (
      params.hrApprovers.every((slackId) =>
        ruleSet.hr_approvers.includes(slackId),
      )
    ) {
      return write();
    }

    return this.transactions.transaction(async () => {
      const updated = await write();

      await this.eventEmitter.emitAsync(
        APPROVERS_CHANGED,
        new ApproversChangedEvent(slackTeamId),
      );

      return updated;
    });
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
