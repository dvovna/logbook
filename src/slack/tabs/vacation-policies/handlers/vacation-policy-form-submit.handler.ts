import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import PolicyModalViewValuesParser, {
  IVacationPolicyFormData,
} from '@modules/slack/tabs/vacation-policies/parsers/policy-modal-view-values.parser';
import VacationPoliciesService, {
  ICreatedPolicy,
} from '@modules/vacation-policies/services/vacation-policies.service';
import {
  IVacationPolicyModalViewMetadata,
  VacationPolicyModalView,
} from '@modules/slack/tabs/vacation-policies/views/vacation-policy-modal.view';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationPolicyFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class VacationPolicyFormSubmitHandler extends BaseModalFormSubmitHandler<
  IVacationPolicyModalViewMetadata,
  IVacationPolicyFormData,
  ICreatedPolicy
> {
  public constructor(
    private readonly vacationPolicyModalView: VacationPolicyModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly tabNavigationService: TabNavigationService,
    vacationPolicyModalViewValuesParser: PolicyModalViewValuesParser,
  ) {
    super(vacationPolicyModalViewValuesParser);
  }

  // A new policy's notice says whom it applies to and where its holidays
  // are, which its form doesn't have.
  protected successResponse(
    { policy, adoptedByCompanyRules }: ICreatedPolicy,
    user: IUserViewModel,
    metadata: IVacationPolicyModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.VacationPolicies, {
      user,
      notice: metadata.id
        ? `✅ Policy ${policy.name} updated.`
        : [
            `✅ Policy ${policy.name} created.`,
            adoptedByCompanyRules
              ? 'It applies to everyone: the company rules use it.'
              : 'Choose it in the company rules or a team to apply it.',
            'Next: its public holidays, with 🎉 Holidays.',
          ].join(' '),
    });

    return SlackViewResponseFactory.success();
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

  private async update(
    id: string,
    data: IVacationPolicyFormData,
    user: IUserViewModel,
  ): Promise<ICreatedPolicy> {
    const policy = await this.vacationPoliciesService.update(
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

    return { policy, adoptedByCompanyRules: false };
  }

  protected errorResponse(
    errorMessage: string,
    data: IVacationPolicyFormData,
    metadata: IVacationPolicyModalViewMetadata,
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
        errorMessage,
        initialData: initialData || undefined,
      }),
    );
  }
}
