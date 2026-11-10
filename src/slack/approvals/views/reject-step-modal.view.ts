import {
  personLabel,
  VACATION_TYPE_LABELS,
} from '@modules/slack/common/views/data/labels';
import { Injectable } from '@nestjs/common';
import * as pluralize from 'pluralize';
import { formatDateRange } from '@common/utils/date.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { RejectWithReasonModalView } from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';

interface IGetRejectModalParams {
  // The Vacations tab to re-render after the decision; none from a message.
  pageMetadata?: string;
  errorMessage?: string;
}

// The Reject form of a vacation request's approval step, opened from the
// approver's message and from the Vacations tab.
@Injectable()
export class RejectStepModalView {
  public constructor(
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly rejectWithReasonModalView: RejectWithReasonModalView,
  ) {}

  // Only for someone who may decide the step: the form names the requester.
  public async getView(
    stepId: string,
    user: IUserViewModel,
    { pageMetadata, errorMessage }: IGetRejectModalParams = {},
  ) {
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: stepId,
      slackTeamId: user.slack_team_id,
    });

    this.requestWorkflowService.assertCanActOnStep(step, user);

    const request = step.step_data.snapshot;
    const requester = escapeMrkdwn(
      personLabel({ name: request.user_name, email: request.user_email }),
    );

    return this.rejectWithReasonModalView.getView(
      {
        callbackId: ViewCallbackId.RejectRequestStepMessage,
        title: 'Reject Request',
        summary: `*${requester}* · ${VACATION_TYPE_LABELS[request.type].label} · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)})`,
        hint: 'Sent to the requester along with the decision.',
        errorMessage,
      },
      { id: stepId, pageMetadata },
    );
  }
}
