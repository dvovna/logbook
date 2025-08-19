import { Injectable } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';

export const DEFAULT_VACATION_DAYS = 24;
export const DEFAULT_WORK_DAYS = 20;
export const DEFAULT_BONUS_DAYS = 3;
const DEFAULT_VACATION_POLICY_NAME = 'Default Vacation Policy';

type IUpdateParams = {
  vacation_days?: number;
  bonus_days?: number;
};

type IFindParams = {
  id: string;
  slackTeamId: string;
};

@Injectable()
export default class VacationPoliciesService {
  public constructor(
    private readonly vacationPoliciesRepository: VacationPoliciesRepository,
  ) {}

  public findOne({
    id,
    slackTeamId,
  }: IFindParams): Promise<IVacationPolicyViewModel | null> {
    return this.vacationPoliciesRepository.findOne({
      id,
      slack_team_id: slackTeamId,
    });
  }

  public findMany({
    slackTeamId,
  }: Pick<IFindParams, 'slackTeamId'>): Promise<IVacationPolicyViewModel[]> {
    return this.vacationPoliciesRepository.findMany({
      slack_team_id: slackTeamId,
    });
  }

  public update(
    { id, slackTeamId }: IFindParams,
    { vacation_days, bonus_days }: IUpdateParams,
    updatedBy: string,
  ) {
    return this.vacationPoliciesRepository.update(
      {
        id,
        slack_team_id: slackTeamId,
      },
      {
        ...(bonus_days ? { bonus_days } : {}),
        ...(vacation_days ? { vacation_days } : {}),
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
    );
  }

  public createDefaultPolicy(slackTeamId: string, userId?: string) {
    return this.vacationPoliciesRepository.create({
      name: DEFAULT_VACATION_POLICY_NAME,
      slack_team_id: slackTeamId,
      vacation_days: DEFAULT_VACATION_DAYS,
      bonus_days: DEFAULT_BONUS_DAYS,
      working_days: DEFAULT_WORK_DAYS,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    });
  }
}
