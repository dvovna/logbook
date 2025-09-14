import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { VacationPolicyModalView } from 'src/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import { VacationPolicyTabView } from 'src/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import ConfirmationModalView from 'src/slack/common/views/confirmation-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

export enum VacationPoliciesTabModalName {
  CreatePolicy = 'CreatePolicy',
  UpdatePolicy = 'UpdatePolicy',
  DeletePolicy = 'DeletePolicy',
}

interface IPolicyModalViewParams extends IOpenModalBaseParams {
  policyId: string;
}

type VacationPoliciesTabModalViewResolversMapType = {
  [VacationPoliciesTabModalName.CreatePolicy]: (
    params: IOpenModalBaseParams,
  ) => View;
  [VacationPoliciesTabModalName.UpdatePolicy]: (
    params: IPolicyModalViewParams,
  ) => Promise<View>;
  [VacationPoliciesTabModalName.DeletePolicy]: (
    params: IPolicyModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class VacationPoliciesTabService extends BaseTabService<VacationPoliciesTabModalViewResolversMapType> {
  public constructor(
    private readonly vacationPolicyModalViewService: VacationPolicyModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly manageVacationPoliciesViewService: VacationPolicyTabView,
    private readonly confirmationModalViewService: ConfirmationModalView,
  ) {
    super(TabId.VacationPolicies, {
      [VacationPoliciesTabModalName.CreatePolicy]: (params) =>
        this.getCreateVacationPolicyModalView(params.errorMessage),
      [VacationPoliciesTabModalName.UpdatePolicy]: (params) =>
        this.getUpdateVacationPolicyModalView(
          params.user,
          params.policyId,
          params.errorMessage,
        ),
      [VacationPoliciesTabModalName.DeletePolicy]: (params) =>
        this.getDeletePolicyModalView(
          params.user,
          params.policyId,
          params.errorMessage,
        ),
    });
  }

  public async getTabView({ user }: IPublishBaseParams) {
    const policies = await this.vacationPoliciesService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.manageVacationPoliciesViewService.getView({
      userId: user.slack_id,
      userRole: user.role,
      policies,
    });
  }

  public getCreateVacationPolicyModalView(errorMessage?: string) {
    return this.vacationPolicyModalViewService.getView({ errorMessage });
  }

  public async getUpdateVacationPolicyModalView(
    user: IUserViewModel,
    policyId: string,
    errorMessage?: string,
  ) {
    const policy = await this.vacationPoliciesService.findOneWithValidation({
      id: policyId,
      slackTeamId: user.slack_team_id,
    });

    return this.vacationPolicyModalViewService.getView({
      initialData: {
        id: policy.id,
        name: policy.name,
        vacation_days: policy.vacation_days,
        working_days: policy.working_days,
        bonus_days: policy.bonus_days,
        carryover_days: policy.carryover_days,
      },
      errorMessage,
    });
  }

  public async getDeletePolicyModalView(
    user: IUserViewModel,
    policyId: string,
    errorMessage?: string,
  ) {
    const policy = await this.vacationPoliciesService.findOneWithValidation({
      id: policyId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalViewService.getView({
      callbackId: ViewCallbackId.DeleteVacationPolicy,
      entityId: policy.id,
      title: 'Delete Vacation Policy',
      message: `:alert: The policy *${policy.name}* will be permanently deleted. This action cannot be undone.`,
      errorMessage,
    });
  }
}
