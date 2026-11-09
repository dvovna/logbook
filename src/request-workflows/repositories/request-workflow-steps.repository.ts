import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { callFunction } from 'src/database/sql-functions';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';

@Injectable()
export class RequestWorkflowStepsRepository extends SqlRepository<
  'request_workflow_steps',
  IRequestWorkflowStepViewModel
> {
  protected readonly tableName = 'request_workflow_steps';

  protected mapToViewModel = (row: SqlRow<'request_workflow_steps'>) => {
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
      processed_at: row.processed_at,
    } as IRequestWorkflowStepViewModel;
  };

  // Decides the request's open steps in one statement (decide_workflow_steps):
  // all of them, one level's, or one step. Returns the steps it decided, none
  // when someone else decided them first.
  public async decide(params: {
    slackTeamId: string;
    requestId: string;
    status: string;
    decidedBySlackId: string;
    stepId?: string;
    stepLevel?: number;
  }): Promise<IRequestWorkflowStepViewModel[]> {
    const rows = await callFunction(this.db, 'decide_workflow_steps', {
      p_slack_team_id: params.slackTeamId,
      p_request_id: params.requestId,
      p_status: params.status,
      p_decided_by_slack_id: params.decidedBySlackId,
      p_step_id: params.stepId,
      p_step_level: params.stepLevel,
    });

    return rows.map(this.mapToViewModel);
  }
}
