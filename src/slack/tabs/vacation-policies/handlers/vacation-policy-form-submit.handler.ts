import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import PolicyModalViewValuesParser, {
  IVacationPolicyFormData,
} from 'src/slack/tabs/vacation-policies/parsers/policy-modal-view-values.parser';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import {
  IVacationPolicyModalViewMetadata,
  VacationPolicyModalView,
} from 'src/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { IVacationRequestModalViewMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationPolicyFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class VacationPolicyFormSubmitHandler extends BaseModalFormSubmitHandler<
  IVacationPolicyModalViewMetadata,
  IVacationPolicyFormData,
  IVacationPolicyViewModel
> {
  public constructor(
    private readonly vacationPolicyModalView: VacationPolicyModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly tabNavigationService: TabNavigationService,
    vacationPolicyModalViewValuesParser: PolicyModalViewValuesParser,
  ) {
    super(vacationPolicyModalViewValuesParser);
  }

  protected successResponse(
    _request: IVacationPolicyViewModel,
    user: IUserViewModel,
    metadata: IVacationPolicyModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.VacationPolicies, {
      user,
    });

    return SlackViewResponseFactory.update(
      this.vacationPolicyModalView.getSuccessView(
        `✅ Vacation Policy was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: IVacationPolicyFormData,
    metadata: IVacationPolicyModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(data: IVacationPolicyFormData, user: IUserViewModel) {
    return this.vacationPoliciesService.create(
      {
        name: data.name,
        vacationDays: data.vacation_days,
        workingDays: data.working_days,
        bonusDays: data.bonus_days,
        carryoverDays: data.carryover_days,
        slackTeamId: user.slack_team_id,
      },
      user,
    );
  }

  private update(
    id: string,
    data: IVacationPolicyFormData,
    user: IUserViewModel,
  ) {
    return this.vacationPoliciesService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        name: data.name,
        vacationDays: data.vacation_days,
        workingDays: data.working_days,
        bonusDays: data.bonus_days,
        carryoverDays: data.carryover_days,
      },
      user,
    );
  }

  protected errorResponse(
    errorMessage: string,
    data: IVacationPolicyFormData,
    metadata: IVacationRequestModalViewMetadata,
  ) {
    const initialData = metadata.id && {
      id: metadata.id,
      name: data.name,
      vacation_days: data.vacation_days,
      working_days: data.working_days,
      bonus_days: data.bonus_days,
      carryover_days: data.carryover_days,
    };

    return SlackViewResponseFactory.update(
      this.vacationPolicyModalView.getView({
        errorMessage: errorMessage,
        initialData: initialData || undefined,
      }),
    );
  }
}
