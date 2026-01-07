import { Injectable } from '@nestjs/common';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { VacationPolicyModalView } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import {
  IVacationPoliciesTabMetaData,
  VacationPolicyTabView,
} from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';

export enum VacationPoliciesTabModalName {
  CreatePolicy = 'CreatePolicy',
  UpdatePolicy = 'UpdatePolicy',
  DeletePolicy = 'DeletePolicy',
}

interface IPolicyModalViewParams extends IOpenModalBaseParams<string> {
  policyId: string;
}

interface IGetVacationPoliciesTabViewParams extends IPublishBaseParams {
  metadata?: IVacationPoliciesTabMetaData;
}

const DEFAULT_POLICIES_PAGE_SIZE = 5;

type VacationPoliciesTabModalViewResolversMapType = {
  [VacationPoliciesTabModalName.CreatePolicy]: (
    params: IOpenModalBaseParams<string>,
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
    private readonly vacationPolicyModalView: VacationPolicyModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly vacationPoliciesTabView: VacationPolicyTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.VacationPolicies, {
      [VacationPoliciesTabModalName.CreatePolicy]: (params) =>
        this.getCreateVacationPolicyModalView(params),
      [VacationPoliciesTabModalName.UpdatePolicy]: (params) =>
        this.getUpdateVacationPolicyModalView(params),
      [VacationPoliciesTabModalName.DeletePolicy]: (params) =>
        this.getDeletePolicyModalView(params),
    });
  }

  public async getTabView({
    user,
    metadata = {},
  }: IGetVacationPoliciesTabViewParams) {
    const policies = await this.vacationPoliciesService.search({
      filters: {
        slackTeamId: user.slack_team_id,
      },
      page: metadata.page,
      pageSize: DEFAULT_POLICIES_PAGE_SIZE,
      orderBy: ['name:asc'],
    });

    return this.vacationPoliciesTabView.getView({
      userId: user.slack_id,
      userRole: user.role,
      policies,
    });
  }

  public getCreateVacationPolicyModalView(
    params: IOpenModalBaseParams<string>,
  ) {
    const { errorMessage, pageMetadata } = params;

    return this.vacationPolicyModalView.getView(
      { errorMessage },
      { pageMetadata },
    );
  }

  public async getUpdateVacationPolicyModalView(
    params: IPolicyModalViewParams,
  ) {
    const { user, policyId, errorMessage, pageMetadata } = params;

    const policy = await this.vacationPoliciesService.findOneWithValidation({
      id: policyId,
      slackTeamId: user.slack_team_id,
    });

    return this.vacationPolicyModalView.getView(
      {
        initialData: {
          id: policy.id,
          name: policy.name,
          vacation_days: policy.vacation_days,
          working_days: policy.working_days,
          bonus_days: policy.bonus_days,
          carryover_days: policy.carryover_days,
        },
        errorMessage,
      },
      { id: policy.id, pageMetadata },
    );
  }

  public async getDeletePolicyModalView(params: IPolicyModalViewParams) {
    const { user, policyId, errorMessage, pageMetadata } = params;

    const policy = await this.vacationPoliciesService.findOneWithValidation({
      id: policyId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteVacationPolicy,
        title: 'Delete Vacation Policy',
        message: `:alert: The policy *${policy.name}* will be permanently deleted. This action cannot be undone.`,
        errorMessage,
      },
      {
        id: policy.id,
        pageMetadata,
      },
    );
  }
}
