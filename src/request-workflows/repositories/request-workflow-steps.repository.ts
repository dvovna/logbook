import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  Tables,
} from 'src/common/repositories/base.repository';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';

@Injectable()
export class RequestWorkflowStepsRepository extends BaseRepository<
  Tables['request_workflow_steps'],
  IRequestWorkflowStepViewModel
> {
  protected readonly tableName = 'request_workflow_steps';

  protected mapToViewModel = (row: Tables['request_workflow_steps']['Row']) => {
    return {
      id: row.id,
      request_id: row.request_id,
      slack_team_id: row.slack_team_id,
      slack_user_id: row.slack_user_id,
      step_level: row.step_level,
      step_type: row.step_type as WorkflowStepType,
      slack_message_ts: row.slack_message_ts,
      slack_channel_id: row.slack_channel_id,
      step_data:
        row.step_data as unknown as IRequestWorkflowStepViewModel['step_data'],
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    } as IRequestWorkflowStepViewModel;
  };
}
