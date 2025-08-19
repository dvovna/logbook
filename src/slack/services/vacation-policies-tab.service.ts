import { Injectable } from '@nestjs/common';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { VacationPolicyModalViewService } from 'src/slack/services/slack-views/vacation-policy-modal-view.service';
import { VacationPolicyManagementTabViewService } from 'src/slack/services/slack-views/vacation-policy-management-tab-view.service';

@Injectable()
export class VacationPoliciesTabService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationPolicyModalViewService: VacationPolicyModalViewService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly manageVacationPoliciesViewService: VacationPolicyManagementTabViewService,
  ) {}

  public async publishVacationPoliciesTab(user: IUserViewModel) {
    const policies = await this.vacationPoliciesService.findMany({
      slackTeamId: user.slack_team_id,
    });

    await this.slackCommunicationService.publishView(
      this.manageVacationPoliciesViewService.getView({
        userId: user.slack_id,
        policies,
      }),
      user.slack_team_id,
    );
  }

  public async getVacationPolicyModalView(
    user: IUserViewModel,
    policyId: string | null,
    generalError?: string,
  ) {
    const policy = policyId
      ? await this.vacationPoliciesService.findOne({
        id: policyId,
        slackTeamId: user.slack_team_id,
      })
      : null;

    return this.vacationPolicyModalViewService.getView({
      policy,
      generalError,
    });
  }
}
