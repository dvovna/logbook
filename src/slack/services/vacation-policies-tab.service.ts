import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { VacationPolicyModalViewService } from 'src/slack/services/slack-views/modal-views/vacation-policy-modal-view.service';
import { VacationPolicyTabViewService } from 'src/slack/services/slack-views/tab-views/vacation-policy-tab-view.service';
import BaseTabViewService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/services/base-tab-view.service';
import { View } from '@slack/types/dist/views';
import DeleteEntityModalViewService from 'src/slack/services/slack-views/modal-views/delete-entity-modal-view.service';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

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
  ) => Promise<View>;
  [VacationPoliciesTabModalName.UpdatePolicy]: (
    params: IPolicyModalViewParams,
  ) => Promise<View>;
  [VacationPoliciesTabModalName.DeletePolicy]: (
    params: IPolicyModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class VacationPoliciesTabService extends BaseTabViewService<VacationPoliciesTabModalViewResolversMapType> {
  public constructor(
    private readonly vacationPolicyModalViewService: VacationPolicyModalViewService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly manageVacationPoliciesViewService: VacationPolicyTabViewService,
    private readonly deleteEntityModalViewService: DeleteEntityModalViewService,
  ) {
    super({
      [VacationPoliciesTabModalName.CreatePolicy]: (params) =>
        this.getVacationPolicyModalView(params.user, null, params.errorMessage),
      [VacationPoliciesTabModalName.UpdatePolicy]: (params) =>
        this.getVacationPolicyModalView(
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
      policies,
    });
  }

  public async getVacationPolicyModalView(
    user: IUserViewModel,
    policyId: string | null,
    errorMessage?: string,
  ) {
    const policy = policyId
      ? await this.vacationPoliciesService.findOne({
        id: policyId,
        slackTeamId: user.slack_team_id,
      })
      : null;

    return this.vacationPolicyModalViewService.getView({
      policy,
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

    return this.deleteEntityModalViewService.getView({
      callbackId: ViewCallbackId.DeletePolicy,
      entityType: 'policy',
      entityId: policy.id,
      entityName: policy.name,
      errorMessage,
    });
  }
}
