import { Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { VacationRequestDetailsModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-details-modal.view';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';

export interface IViewVacationRequestModalViewParams
  extends IOpenModalBaseParams {
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
          orderBy: ['step_level:asc', 'processed_at:desc'],
        },
      ),
      this.requestWorkflowStepCommentsService.findMany({
        requestId,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    return this.vacationRequestDetailsModalView.getView(
      {
        errorMessage,
        request,
        steps,
        reviewComments,
      },
      { pageMetadata },
    );
  }
}
