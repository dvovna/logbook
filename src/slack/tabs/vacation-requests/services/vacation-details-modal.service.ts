import { currentRunOf } from '@modules/request-workflows/utils/workflow-runs';
import { ForbiddenException, Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { VacationRequestDetailsModalView } from '@modules/slack/tabs/vacation-requests/views/vacation-request-details-modal.view';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';

export interface IViewVacationRequestModalViewParams extends IOpenModalBaseParams {
  requestId: string;
  pageMetadata?: string;
}

@Injectable()
export class VacationDetailsModalService {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationRequestDetailsModalView: VacationRequestDetailsModalView,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly teamsService: TeamsService,
  ) {}

  public async getModal({
    requestId,
    user,
    errorMessage,
    pageMetadata = '',
  }: IViewVacationRequestModalViewParams): Promise<View> {
    const [request, steps, reviewComments] = await Promise.all([
      this.vacationRequestsService.findOneWithValidation({
        id: requestId,
        slackTeamId: user.slack_team_id,
      }),
      this.requestWorkflowStepsService.findMany(
        {
          requestId,
          slackTeamId: user.slack_team_id,
          processed: true,
        },
        {
          orderBy: ['step_level:asc', 'completed_at:asc', 'processed_at:desc'],
        },
      ),
      this.requestWorkflowStepCommentsService.findMany({
        requestId,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    await this.assertCanView(user, request);

    return this.vacationRequestDetailsModalView.getView(
      {
        errorMessage,
        request,
        // The steps of an earlier run decided on the request before an edit.
        steps: currentRunOf(steps),
        reviewComments,
      },
      { pageMetadata },
    );
  }

  // The requester, Admin and HR, the request's approvers, and the managers of
  // the requester's team see a request. The ID comes from the client.
  private async assertCanView(
    user: IUserViewModel,
    request: IVacationRequestViewModel,
  ) {
    if (request.user_id === user.id) {
      return;
    }

    const [approverSteps, managedTeamIds] = await Promise.all([
      this.requestWorkflowStepsService.findMany({
        requestId: request.id,
        slackUserId: user.slack_id,
        slackTeamId: user.slack_team_id,
      }),
      this.teamsService.findManagedTeamIds(user),
    ]);

    if (
      approverSteps.length ||
      managedTeamIds === null ||
      managedTeamIds.includes(request.team_id ?? '')
    ) {
      return;
    }

    throw new ForbiddenException('You cannot see this vacation request.');
  }
}
