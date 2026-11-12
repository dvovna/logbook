import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';
import { IVacationPeriodUsage } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import {
  leaveBalanceOf,
  requestWindowOf,
  toFileBalance,
} from '@modules/vacation-requests/utils/leave-balance.utils';

interface IVacationsUsageService {
  getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsage>;
  getVacationPeriodUsage(
    user: IUserViewModel,
    date: Date,
    options?: { excludeRequestId?: string },
  ): Promise<IVacationPeriodUsage>;
}

@Injectable()
export class VacationsUsageService implements IVacationsUsageService {
  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationPeriodUsageService: VacationPeriodUsageService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly leaveBalancesService: LeaveBalancesService,
  ) {}

  public getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsage> {
    return this.getVacationPeriodUsage(user, new Date());
  }

  // The balance of the vacation year that holds `date` (leaveBalanceOf),
  // with the file balance it read. `limits` is null when no vacation policy
  // applies to the user (neither their team's nor the company rules'): usage
  // is tracked, but nothing is enforced.
  public async getVacationPeriodUsage(
    user: IUserViewModel,
    date: Date,
    { excludeRequestId }: { excludeRequestId?: string } = {},
  ): Promise<IVacationPeriodUsage> {
    const person = {
      contractStartDate: user.contract_start_date ?? null,
      createdAt: user.created_at,
      carryoverDays: user.carryover_days ?? null,
      date,
      today: new Date(),
    };
    const window = requestWindowOf({
      ...person,
      policy: null,
      fileBalance: null,
    });
    const ownRules = this.teamRulesService.forTeam(
      user.team_id,
      user.slack_team_id,
    );
    const requestsFrom = (from: Date) =>
      this.vacationPeriodUsageService.countedRequests(user, from, window.to, {
        excludeRequestId,
        ownRules,
      });

    const [requests, policy, balance] = await Promise.all([
      requestsFrom(window.from),
      this.findPolicy(user, ownRules),
      this.leaveBalancesService.findOfUser(user.id, user.slack_team_id),
    ]);
    const input = {
      ...person,
      policy,
      fileBalance: balance && toFileBalance(balance),
    };
    // A file balance whose day a moved contract start put in a year before
    // the one the person joined in carries over from there.
    const { from } = requestWindowOf(input);

    return {
      ...leaveBalanceOf({
        ...input,
        requests: from < window.from ? await requestsFrom(from) : requests,
      }),
      fileBalance: balance,
    };
  }

  private async findPolicy(
    user: IUserViewModel,
    ownRules: Promise<IEffectiveTeamRules>,
  ): Promise<IVacationPolicyViewModel | null> {
    const { vacationPolicyId } = await ownRules;

    return vacationPolicyId
      ? this.vacationPoliciesService.findOne({
          id: vacationPolicyId,
          slackTeamId: user.slack_team_id,
        })
      : null;
  }
}
