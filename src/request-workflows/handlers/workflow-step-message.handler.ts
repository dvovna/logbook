import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from 'src/slack/common/handlers/base-action.handler';
import { ApproverMessageActionId } from 'src/request-workflows/enums/approver-message-action-id.enum';
import { withButtonAction } from 'src/slack/common/utils/view.utils';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.WorkflowStepMessage,
  type: 'block_actions',
})
export default class WorkflowStepMessageHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {
    super();

    this.actionMap = {
      [ApproverMessageActionId.Approve]:
        withButtonAction<ApproverMessageActionId>(this.handleUserAction),
      [ApproverMessageActionId.Reject]:
        withButtonAction<ApproverMessageActionId>(this.handleUserAction),
    };
  }

  private handleUserAction = async (
    type: ApproverMessageActionId,
    stepId: string,
    user: IUserViewModel,
  ) => {
    if (type === ApproverMessageActionId.Approve) {
      await this.requestWorkflowService.approveStep(stepId, user);

      return;
    }

    await this.requestWorkflowService.rejectStep(stepId, user);
  };
}
